import { type Db, telegramChatBindings } from '@timeline/db';
import { eq } from 'drizzle-orm';

import { childLogger } from '#src/logger.js';

const log = childLogger('telegram');

export const TELEGRAM_CHAT_MIGRATION_CONFLICT_CODE =
  'telegram_chat_migration_cross_team_conflict' as const;

export class TelegramChatMigrationConflictError extends Error {
  readonly code = TELEGRAM_CHAT_MIGRATION_CONFLICT_CODE;

  constructor() {
    super('Telegram chat migration conflict: new chat id is bound to another team');
    this.name = 'TelegramChatMigrationConflictError';
  }
}

export function isTelegramChatMigrationConflictError(
  error: unknown,
): error is TelegramChatMigrationConflictError {
  return error instanceof TelegramChatMigrationConflictError;
}

export interface TelegramChatMigration {
  fromChatId: number;
  toChatId: number;
}

function asSafeChatId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

/** Read `parameters.migrate_to_chat_id` from a Telegram API error body or message. */
export function parseTelegramMigratedChatId(payload: unknown): number | null {
  if (typeof payload === 'string') {
    const start = payload.indexOf('{');
    if (start < 0) return null;
    try {
      return parseTelegramMigratedChatId(JSON.parse(payload.slice(start)));
    } catch {
      return null;
    }
  }
  if (!payload || typeof payload !== 'object') return null;
  const parameters = (payload as { parameters?: unknown }).parameters;
  if (!parameters || typeof parameters !== 'object') return null;
  return asSafeChatId((parameters as { migrate_to_chat_id?: unknown }).migrate_to_chat_id);
}

export function telegramMigratedChatId(error: unknown): number | null {
  if (error && typeof error === 'object' && 'migrateToChatId' in error) {
    const attached = asSafeChatId(error.migrateToChatId);
    if (attached !== null) return attached;
  }
  if (error instanceof Error) return parseTelegramMigratedChatId(error.message);
  return null;
}

export function telegramChatIdFromBody(body: unknown): number | null {
  if (!body || typeof body !== 'object' || !('chat_id' in body)) return null;
  return asSafeChatId(body.chat_id);
}

export function replaceTelegramChatId(body: unknown, chatId: number): void {
  if (!body || typeof body !== 'object' || !('chat_id' in body)) return;
  (body as { chat_id: number }).chat_id = chatId;
}

export function telegramChatMigrationFromMessage(
  message:
    | {
        chat: { id: number };
        migrate_to_chat_id?: number | undefined;
        migrate_from_chat_id?: number | undefined;
      }
    | undefined,
): TelegramChatMigration | null {
  if (!message) return null;
  if (message.migrate_to_chat_id !== undefined) {
    const toChatId = asSafeChatId(message.migrate_to_chat_id);
    if (toChatId === null) return null;
    return { fromChatId: message.chat.id, toChatId };
  }
  if (message.migrate_from_chat_id !== undefined) {
    const fromChatId = asSafeChatId(message.migrate_from_chat_id);
    if (fromChatId === null) return null;
    return { fromChatId, toChatId: message.chat.id };
  }
  return null;
}

/** Synthetic team actor; same id as `TEAM_BOT_ACTOR_USER_ID` in the agent runtime. */
const TELEGRAM_MIGRATION_ACTOR_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Confirm the migrated chat id is not bound to a different team.
 *
 * Completes only after both binding lookups succeed. Throws
 * {@link TelegramChatMigrationConflictError} on a cross-team collision.
 * Lookup failures propagate so callers can fail closed instead of retrying
 * a send to an unverified chat id.
 */
export async function verifyTelegramChatMigrationOwnership(
  db: Db,
  fromChatId: number,
  toChatId: number,
): Promise<{ teamId: string } | null> {
  if (
    fromChatId === toChatId ||
    !Number.isSafeInteger(fromChatId) ||
    !Number.isSafeInteger(toChatId)
  ) {
    return null;
  }

  const [oldBinding] = await db
    .select({ teamId: telegramChatBindings.teamId })
    .from(telegramChatBindings)
    .where(eq(telegramChatBindings.tgChatId, fromChatId))
    .limit(1);
  const [newBinding] = await db
    .select({ teamId: telegramChatBindings.teamId })
    .from(telegramChatBindings)
    .where(eq(telegramChatBindings.tgChatId, toChatId))
    .limit(1);

  if (oldBinding && newBinding && oldBinding.teamId !== newBinding.teamId) {
    log.error(
      { fromChatId, toChatId, oldTeamId: oldBinding.teamId, newTeamId: newBinding.teamId },
      'telegram chat migration skipped: new chat id is bound to another team',
    );
    throw new TelegramChatMigrationConflictError();
  }

  const teamId = oldBinding?.teamId ?? newBinding?.teamId;
  return teamId ? { teamId } : null;
}

/**
 * Rewrite stored Telegram group/supergroup ids after Telegram upgrades a chat.
 * Bindings and digest destinations are the live send/route keys. Captured
 * raw-event metadata stays immutable.
 *
 * `tg_chat_id` is globally unique, so the binding lookup is the discovery seam
 * that yields the owning team. Workspace writes then go through `withTeam`.
 */
export async function applyTelegramChatMigration(
  db: Db,
  fromChatId: number,
  toChatId: number,
): Promise<void> {
  const ownership = await verifyTelegramChatMigrationOwnership(db, fromChatId, toChatId);
  if (!ownership) return;

  // Dynamic import keeps the HTTP Telegram client graph from pulling the
  // whole workspace port at module load.
  const { withTeam } = await import('#src/team-scope.js');
  await withTeam(db, ownership.teamId, TELEGRAM_MIGRATION_ACTOR_USER_ID, {
    skipMembershipCheck: true,
  }).telegram.migrateChatId({ fromChatId, toChatId });
}
