import { type Db, telegramChatBindings } from '@timeline/db';
import { eq } from 'drizzle-orm';

import { childLogger } from '#src/logger.js';
import { rewriteWorkspaceDigestDedupeKeyTarget } from '#src/messaging/destinations.js';

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

export interface TelegramChatMigrationWriteResult {
  /** New-chat workspace digest keys that already exist as `sent`. */
  alreadySentDedupeKeys: string[];
  /** New-chat workspace digest keys owned by an existing pending or failed delivery. */
  retryableDedupeKeys: string[];
}

const EMPTY_TELEGRAM_CHAT_MIGRATION_WRITE_RESULT: TelegramChatMigrationWriteResult = {
  alreadySentDedupeKeys: [],
  retryableDedupeKeys: [],
};

export function isTelegramChatMigrationConflictError(
  error: unknown,
): error is TelegramChatMigrationConflictError {
  return error instanceof TelegramChatMigrationConflictError;
}

const TELEGRAM_CHAT_BINDINGS_TG_CHAT_ID_UNIQUE = 'telegram_chat_bindings_tg_chat_id_unique';

function isPostgresUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth += 1) {
    const record = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
      message?: unknown;
    };
    if (record.code === '23505' || record.code === 23505) return true;
    if (record.constraint === TELEGRAM_CHAT_BINDINGS_TG_CHAT_ID_UNIQUE) return true;
    if (
      typeof record.message === 'string' &&
      /duplicate key value violates unique constraint/i.test(record.message)
    ) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

/**
 * Map a failed migration write onto the fail-closed persist contract.
 *
 * Unique-constraint collisions (the TOCTOU where another workspace binds the
 * new chat id after the ownership check) become
 * {@link TelegramChatMigrationConflictError}. Other errors rethrow so callers
 * skip the redirected send instead of swallowing a failed write.
 */
export function rethrowTelegramChatMigrationWriteError(error: unknown): never {
  if (isTelegramChatMigrationConflictError(error)) throw error;
  if (isPostgresUniqueViolation(error)) {
    log.error({ err: error }, 'telegram chat migration skipped: new chat id unique constraint');
    throw new TelegramChatMigrationConflictError();
  }
  throw error;
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

export interface TelegramChatMigrationVerifyOptions {
  /**
   * Workspace that is trying to send. Required before a redirected Bot API
   * retry: discovering who currently owns the destination chat is not enough
   * to authorize another workspace's content.
   */
  sendingTeamId?: string;
}

/**
 * Confirm the migrated chat id is not bound to a different team.
 *
 * Completes only after both binding lookups succeed. Throws
 * {@link TelegramChatMigrationConflictError} on a cross-team collision.
 * Lookup failures propagate so callers can fail closed instead of retrying
 * a send to an unverified chat id.
 *
 * When `sendingTeamId` is set, the sending workspace must itself own the old
 * binding, the new binding, or both. An absent old binding must not fall back
 * to another team's new binding — that is the unlink-then-relink leak.
 */
export async function verifyTelegramChatMigrationOwnership(
  db: Db,
  fromChatId: number,
  toChatId: number,
  options?: TelegramChatMigrationVerifyOptions,
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

  const sendingTeamId = options?.sendingTeamId;
  if (sendingTeamId) {
    const senderOwnsOld = oldBinding?.teamId === sendingTeamId;
    const senderOwnsNew = newBinding?.teamId === sendingTeamId;
    if (newBinding && !senderOwnsNew) {
      log.error(
        {
          fromChatId,
          toChatId,
          sendingTeamId,
          newTeamId: newBinding.teamId,
        },
        'telegram chat migration skipped: sending workspace does not own the new chat',
      );
      throw new TelegramChatMigrationConflictError();
    }
    if (oldBinding && !senderOwnsOld) {
      log.error(
        {
          fromChatId,
          toChatId,
          sendingTeamId,
          oldTeamId: oldBinding.teamId,
        },
        'telegram chat migration skipped: sending workspace does not own the old chat',
      );
      throw new TelegramChatMigrationConflictError();
    }
    if (!senderOwnsOld && !senderOwnsNew) {
      log.error(
        { fromChatId, toChatId, sendingTeamId },
        'telegram chat migration skipped: sending workspace ownership could not be established',
      );
      return null;
    }
    return { teamId: sendingTeamId };
  }

  const teamId = oldBinding?.teamId ?? newBinding?.teamId;
  return teamId ? { teamId } : null;
}

/**
 * Decide whether an in-flight send should retry after a persisted migration.
 *
 * Workspace digest keys are per destination. If this send's rewritten key
 * already exists as `sent`, the caller must not post again. A `pending` or `failed`
 * collision leaves delivery to the canonical key without reporting this send as delivered.
 */
export function telegramMigratedDigestRedirectDisposition(input: {
  inFlightDedupeKey: string | undefined;
  teamId: string | undefined;
  fromChatId: number;
  toChatId: number;
  alreadySentDedupeKeys: readonly string[];
  retryableDedupeKeys?: readonly string[];
}): { alreadyDelivered: boolean; skipRedirect: boolean } {
  const { inFlightDedupeKey, teamId } = input;
  if (!inFlightDedupeKey || !teamId) {
    return { alreadyDelivered: false, skipRedirect: false };
  }
  const nextKey = rewriteWorkspaceDigestDedupeKeyTarget({
    dedupeKey: inFlightDedupeKey,
    teamId,
    kind: 'telegram_chat',
    fromTargetId: String(input.fromChatId),
    toTargetId: String(input.toChatId),
  });
  if (!nextKey) return { alreadyDelivered: false, skipRedirect: false };
  if (input.alreadySentDedupeKeys.includes(nextKey)) {
    return { alreadyDelivered: true, skipRedirect: true };
  }
  if (input.retryableDedupeKeys?.includes(nextKey)) {
    return { alreadyDelivered: false, skipRedirect: true };
  }
  return { alreadyDelivered: false, skipRedirect: false };
}

/**
 * The sending workspace must still own the migrated chat before a redirected
 * Bot API retry. A post-write unlink+relink must not deliver another team's
 * content into the new chat.
 */
export async function assertTelegramChatRedirectOwnership(
  db: Db,
  toChatId: number,
  sendingTeamId: string,
): Promise<void> {
  const [binding] = await db
    .select({ teamId: telegramChatBindings.teamId })
    .from(telegramChatBindings)
    .where(eq(telegramChatBindings.tgChatId, toChatId))
    .limit(1);
  if (binding?.teamId !== sendingTeamId) {
    log.error(
      { toChatId, sendingTeamId, boundTeamId: binding?.teamId ?? null },
      'telegram chat migration skipped: sending workspace does not own the redirected chat',
    );
    throw new TelegramChatMigrationConflictError();
  }
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
  options?: TelegramChatMigrationVerifyOptions,
): Promise<TelegramChatMigrationWriteResult> {
  const ownership = await verifyTelegramChatMigrationOwnership(db, fromChatId, toChatId, options);
  if (!ownership) return EMPTY_TELEGRAM_CHAT_MIGRATION_WRITE_RESULT;
  if (options?.sendingTeamId && ownership.teamId !== options.sendingTeamId) {
    throw new TelegramChatMigrationConflictError();
  }

  // Dynamic import keeps the HTTP Telegram client graph from pulling the
  // whole workspace port at module load.
  const { withTeam } = await import('#src/team-scope.js');
  try {
    const writeResult = await withTeam(db, ownership.teamId, TELEGRAM_MIGRATION_ACTOR_USER_ID, {
      skipMembershipCheck: true,
    }).telegram.migrateChatId({ fromChatId, toChatId });
    if (options?.sendingTeamId) {
      await assertTelegramChatRedirectOwnership(db, toChatId, options.sendingTeamId);
    }
    return writeResult;
  } catch (err) {
    rethrowTelegramChatMigrationWriteError(err);
  }
}
