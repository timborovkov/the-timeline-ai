import { type Db, teamDigestDestinations, telegramChatBindings } from '@timeline/db';
import { and, eq } from 'drizzle-orm';

import { childLogger } from '#src/logger.js';

const log = childLogger('telegram');

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

/**
 * Rewrite stored Telegram group/supergroup ids after Telegram upgrades a chat.
 * Bindings and digest destinations are the live send/route keys. Captured
 * raw-event metadata stays immutable.
 */
export async function applyTelegramChatMigration(
  db: Db,
  fromChatId: number,
  toChatId: number,
): Promise<void> {
  if (
    fromChatId === toChatId ||
    !Number.isSafeInteger(fromChatId) ||
    !Number.isSafeInteger(toChatId)
  ) {
    return;
  }
  const fromTarget = String(fromChatId);
  const toTarget = String(toChatId);

  await db.transaction(async (tx) => {
    const [oldBinding] = await tx
      .select({
        id: telegramChatBindings.id,
        teamId: telegramChatBindings.teamId,
      })
      .from(telegramChatBindings)
      .where(eq(telegramChatBindings.tgChatId, fromChatId))
      .limit(1);
    const [newBinding] = await tx
      .select({
        id: telegramChatBindings.id,
        teamId: telegramChatBindings.teamId,
      })
      .from(telegramChatBindings)
      .where(eq(telegramChatBindings.tgChatId, toChatId))
      .limit(1);

    if (oldBinding && newBinding) {
      if (oldBinding.teamId === newBinding.teamId) {
        await tx.delete(telegramChatBindings).where(eq(telegramChatBindings.id, oldBinding.id));
      } else {
        log.warn(
          { fromChatId, toChatId, oldTeamId: oldBinding.teamId, newTeamId: newBinding.teamId },
          'telegram chat migration skipped binding rewrite: both ids already bound',
        );
      }
    } else if (oldBinding) {
      await tx
        .update(telegramChatBindings)
        .set({ tgChatId: toChatId })
        .where(eq(telegramChatBindings.id, oldBinding.id));
    }

    const destinations = await tx
      .select({
        id: teamDigestDestinations.id,
        teamId: teamDigestDestinations.teamId,
      })
      .from(teamDigestDestinations)
      .where(
        and(
          eq(teamDigestDestinations.kind, 'telegram_chat'),
          eq(teamDigestDestinations.targetId, fromTarget),
        ),
      );

    for (const destination of destinations) {
      const [conflict] = await tx
        .select({ id: teamDigestDestinations.id })
        .from(teamDigestDestinations)
        .where(
          and(
            eq(teamDigestDestinations.teamId, destination.teamId),
            eq(teamDigestDestinations.kind, 'telegram_chat'),
            eq(teamDigestDestinations.targetId, toTarget),
          ),
        )
        .limit(1);
      if (conflict) {
        await tx
          .delete(teamDigestDestinations)
          .where(eq(teamDigestDestinations.id, destination.id));
        continue;
      }
      await tx
        .update(teamDigestDestinations)
        .set({ targetId: toTarget, updatedAt: new Date() })
        .where(eq(teamDigestDestinations.id, destination.id));
    }
  });

  log.info({ fromChatId, toChatId }, 'telegram chat migrated');
}
