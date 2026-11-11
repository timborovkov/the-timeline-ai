import {
  type Db,
  dailyDigests,
  messagePreferences,
  slackUsers,
  slackUserTeams,
  teamMembers,
  teamBillingAccounts,
  telegramUsers,
  telegramUserTeams,
  users,
} from '@timeline/db';
import { and, eq, isNull, getTableColumns } from 'drizzle-orm';

import { withChatDeliveryPrincipal } from '#src/conversation-surfaces/deferred-delivery.js';
import { getEnv } from '#src/env.js';
import { claimDelivery, markDeliveryResult } from '#src/messaging/delivery-ledger.js';
import { sendMessage } from '#src/messaging/delivery.js';
import {
  digestDestinationDedupeKey,
  listTeamDigestDestinations,
  personalDigestDestinations,
  sharedDigestDestinations,
  type TeamDigestDestination,
} from '#src/messaging/destinations.js';
import { formatDigestChatText } from '#src/messaging/digest-format.js';
import { isDigestWindowExpired } from '#src/messaging/digest-window.js';
import { generateDailyDigest, getDigestPreference } from '#src/messaging/digest.js';
import { activeWorkspaceCondition } from '#src/platform-admin/runtime.js';
import { sendTeamSlackDirectMessage, sendTeamSlackMessage } from '#src/slack/outbound.js';
import { sendTelegramBotMessage } from '#src/telegram/api.js';

import type {
  DailyDigestPayload,
  MessageChannel,
  SendMessageResult,
} from '#src/messaging/types.js';

export async function sendDailyDigest(input: {
  db: Db;
  digestId: string;
  to: string;
  digestUrl: string;
  fetch?: (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>;
  now?: Date;
}): Promise<SendMessageResult> {
  const rows = await input.db
    .select({
      ...getTableColumns(dailyDigests),
      workspaceActive: activeWorkspaceCondition(dailyDigests.teamId),
    })
    .from(dailyDigests)
    .where(eq(dailyDigests.id, input.digestId))
    .limit(1);
  const digest = rows[0];
  if (!digest) return { ok: false, error: 'Digest not found', retryable: false };
  if (!digest.workspaceActive) return { ok: true, skipped: true, skippedStatus: 'skipped' };

  const recipientRows = await input.db
    .select({
      email: users.email,
      suspendedAt: users.suspendedAt,
      securityState: teamBillingAccounts.securityState,
      removedAt: teamMembers.removedAt,
      dailyDigestEnabled: messagePreferences.dailyDigestEnabled,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .leftJoin(teamBillingAccounts, eq(teamBillingAccounts.teamId, teamMembers.teamId))
    .leftJoin(
      messagePreferences,
      and(
        eq(messagePreferences.teamId, teamMembers.teamId),
        eq(messagePreferences.userId, teamMembers.userId),
      ),
    )
    .where(
      and(
        eq(teamMembers.teamId, digest.teamId),
        eq(teamMembers.userId, digest.userId),
        isNull(teamMembers.removedAt),
      ),
    )
    .limit(1);
  const recipient = recipientRows[0];
  const suspensionReason = recipient?.suspendedAt
    ? 'Recipient is suspended.'
    : recipient?.securityState === 'suspended' || recipient?.securityState === 'terminated'
      ? 'Workspace is suspended.'
      : null;
  if (!recipient || recipient.dailyDigestEnabled === false || suspensionReason) {
    await input.db
      .update(dailyDigests)
      .set({
        status: 'skipped',
        error:
          suspensionReason ??
          (recipient ? 'Daily digest is disabled.' : 'Recipient is no longer a team member.'),
      })
      .where(eq(dailyDigests.id, input.digestId));
    return { ok: true, skipped: true, skippedStatus: 'skipped' };
  }
  const preference = await getDigestPreference({
    db: input.db,
    teamId: digest.teamId,
    userId: digest.userId,
  });
  if (
    isDigestWindowExpired(
      digest.windowEnd,
      input.now ?? new Date(),
      preference.timezone,
      preference.hour,
    )
  ) {
    await input.db
      .update(dailyDigests)
      .set({
        status: 'skipped',
        error: 'Digest window expired before send.',
      })
      .where(eq(dailyDigests.id, input.digestId));
    return { ok: true, skipped: true, skippedStatus: 'skipped' };
  }
  const configuredDestinations = await listTeamDigestDestinations(input.db, digest.teamId);
  const personal =
    configuredDestinations.length === 0
      ? [
          {
            id: 'email-default',
            teamId: digest.teamId,
            kind: 'email_members' as const,
            targetId: null,
            label: null,
            enabled: true,
          },
        ]
      : personalDigestDestinations(configuredDestinations);
  if (personal.length === 0) {
    return { ok: true, skipped: true, skippedStatus: 'skipped' };
  }
  const payload = digest.payload as DailyDigestPayload;
  const results: SendMessageResult[] = [];
  for (const destination of personal) {
    results.push(
      await deliverPersonalDigestDestination({
        db: input.db,
        digest,
        destination,
        email: recipient.email,
        digestUrl: input.digestUrl,
        payload,
        ...(input.fetch ? { fetch: input.fetch } : {}),
      }),
    );
  }
  const result = rollupDeliveryResults(results);
  const digestUpdate =
    result.skipped && result.skippedStatus === 'sent'
      ? {
          status: 'sent' as const,
          error: null,
          deliveryId: result.deliveryId ?? null,
        }
      : result.skipped
        ? {
            status: 'generated' as const,
            error: null,
            deliveryId: result.deliveryId ?? null,
          }
        : {
            status: result.ok ? ('sent' as const) : ('failed' as const),
            sentAt: result.ok ? new Date() : null,
            error: result.error ?? null,
            deliveryId: result.deliveryId ?? null,
          };
  await input.db.update(dailyDigests).set(digestUpdate).where(eq(dailyDigests.id, input.digestId));
  return result;
}

export async function sendWorkspaceDailyDigest(input: {
  db: Db;
  teamId: string;
  windowStart: Date;
  windowEnd: Date;
  digestUrl: string;
  now?: Date;
}): Promise<SendMessageResult> {
  const destinations = sharedDigestDestinations(
    await listTeamDigestDestinations(input.db, input.teamId),
  );
  if (destinations.length === 0) {
    return { ok: true, skipped: true, skippedStatus: 'skipped' };
  }
  const generated = await generateDailyDigest({
    db: input.db,
    teamId: input.teamId,
    userId: '00000000-0000-0000-0000-000000000000',
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    audience: 'workspace',
    ...(input.now ? { now: input.now } : {}),
  });
  if (generated.skipped) {
    return { ok: true, skipped: true, skippedStatus: 'skipped' };
  }
  const results: SendMessageResult[] = [];
  for (const destination of destinations) {
    results.push(
      await deliverSharedDigestDestination({
        db: input.db,
        teamId: input.teamId,
        windowEnd: input.windowEnd.toISOString(),
        destination,
        digestUrl: input.digestUrl,
        payload: generated.payload,
      }),
    );
  }
  return rollupDeliveryResults(results);
}

function rollupDeliveryResults(results: SendMessageResult[]): SendMessageResult {
  const failed = results.find((result) => !result.ok && !result.skipped);
  if (failed) return failed;
  const sent =
    [...results].reverse().find((result) => result.ok && !result.skipped) ??
    results.find((result) => result.skipped && result.skippedStatus === 'sent');
  if (sent) {
    return { ...sent, ok: true };
  }
  return results[0] ?? { ok: true, skipped: true, skippedStatus: 'skipped' };
}

async function deliverPersonalDigestDestination(input: {
  db: Db;
  digest: typeof dailyDigests.$inferSelect;
  destination: TeamDigestDestination;
  email: string;
  digestUrl: string;
  payload: DailyDigestPayload;
  fetch?: (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>;
}): Promise<SendMessageResult> {
  const dedupeKey = digestDestinationDedupeKey({
    scope: 'member',
    digestId: input.digest.id,
    teamId: input.digest.teamId,
    windowEnd: input.digest.windowEnd.toISOString(),
    destination: input.destination,
  });
  if (input.destination.kind === 'email_members') {
    return sendMessage(
      'daily_digest',
      { to: input.email, digestUrl: input.digestUrl, payload: input.payload },
      {
        db: input.db,
        teamId: input.digest.teamId,
        userId: input.digest.userId,
        dedupeKey,
        ...(input.fetch ? { fetch: input.fetch } : {}),
      },
    );
  }
  const text = formatDigestChatText({ payload: input.payload, digestUrl: input.digestUrl });
  if (input.destination.kind === 'slack_dm_members') {
    const slackUserId = await linkedSlackUserId(input.db, input.digest.teamId, input.digest.userId);
    if (!slackUserId) {
      return { ok: true, skipped: true, skippedStatus: 'skipped' };
    }
    return deliverBotDigest({
      db: input.db,
      channel: 'slack',
      provider: 'slack',
      teamId: input.digest.teamId,
      userId: input.digest.userId,
      subject: `Daily digest for ${input.payload.teamName}`,
      dedupeKey,
      metadata: { slack_user_id: slackUserId },
      send: () =>
        sendTeamSlackDirectMessage({
          db: input.db,
          teamId: input.digest.teamId,
          slackUserId,
          text,
        }),
    });
  }
  const telegramChatId = await linkedTelegramChatId(
    input.db,
    input.digest.teamId,
    input.digest.userId,
  );
  if (telegramChatId === null) {
    return { ok: true, skipped: true, skippedStatus: 'skipped' };
  }
  const token = getEnv().TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { ok: false, error: 'Telegram bot is not configured', retryable: false };
  }
  return deliverBotDigest({
    db: input.db,
    channel: 'telegram',
    provider: 'telegram',
    teamId: input.digest.teamId,
    userId: input.digest.userId,
    subject: `Daily digest for ${input.payload.teamName}`,
    dedupeKey,
    metadata: { telegram_chat_id: telegramChatId },
    send: () =>
      sendTelegramBotMessage({
        chatId: telegramChatId,
        text,
        token,
        teamId: input.digest.teamId,
      }),
  });
}

async function deliverSharedDigestDestination(input: {
  db: Db;
  teamId: string;
  windowEnd: string;
  destination: TeamDigestDestination;
  digestUrl: string;
  payload: DailyDigestPayload;
}): Promise<SendMessageResult> {
  const targetId = input.destination.targetId;
  if (!targetId) {
    return { ok: false, error: 'Digest destination is missing a chat.', retryable: false };
  }
  const text = formatDigestChatText({ payload: input.payload, digestUrl: input.digestUrl });
  const dedupeKey = digestDestinationDedupeKey({
    scope: 'workspace',
    teamId: input.teamId,
    windowEnd: input.windowEnd,
    destination: input.destination,
  });
  if (input.destination.kind === 'slack_channel') {
    return deliverBotDigest({
      db: input.db,
      channel: 'slack',
      provider: 'slack',
      teamId: input.teamId,
      subject: `Daily digest for ${input.payload.teamName}`,
      dedupeKey,
      metadata: { slack_channel_id: targetId },
      send: () =>
        sendTeamSlackMessage({
          db: input.db,
          teamId: input.teamId,
          channelId: targetId,
          text,
        }),
    });
  }
  const chatId = Number(targetId);
  if (!Number.isSafeInteger(chatId)) {
    return { ok: false, error: 'Telegram digest chat is invalid.', retryable: false };
  }
  const token = getEnv().TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { ok: false, error: 'Telegram bot is not configured', retryable: false };
  }
  return deliverBotDigest({
    db: input.db,
    channel: 'telegram',
    provider: 'telegram',
    teamId: input.teamId,
    subject: `Daily digest for ${input.payload.teamName}`,
    dedupeKey,
    metadata: { telegram_chat_id: chatId },
    send: () => sendTelegramBotMessage({ chatId, text, token, teamId: input.teamId }),
  });
}

function isPermanentBotFailure(error: string): boolean {
  return /not_in_channel|channel_not_found|account_inactive|invalid_auth|forbidden|chat not found|bot was blocked|bot is not a member/i.test(
    error,
  );
}

async function deliverBotDigest(input: {
  db: Db;
  channel: MessageChannel;
  provider: string;
  teamId: string;
  userId?: string | null;
  subject: string;
  dedupeKey: string;
  metadata?: Record<string, unknown>;
  send: () => Promise<void>;
}): Promise<SendMessageResult> {
  const claim = await claimDelivery({
    db: input.db,
    intent: 'daily_digest',
    channel: input.channel,
    teamId: input.teamId,
    userId: input.userId ?? null,
    subject: input.subject,
    status: 'pending',
    provider: input.provider,
    dedupeKey: input.dedupeKey,
    metadata: input.metadata ?? {},
  });
  if (claim.kind !== 'claimed') return claim.result;
  const deliveryId = claim.deliveryId;
  try {
    await withChatDeliveryPrincipal(
      {
        teamId: input.teamId,
        ...(input.userId ? { userId: input.userId } : {}),
        dedupeKey: input.dedupeKey,
      },
      input.send,
    );
    if (deliveryId) {
      await markDeliveryResult({ db: input.db, deliveryId, status: 'sent' });
    }
    return { ok: true, ...(deliveryId ? { deliveryId } : {}) };
  } catch (err) {
    const error =
      err instanceof Error && err.message ? err.message.slice(0, 500) : 'Failed to send digest';
    const retryable = !isPermanentBotFailure(error);
    if (deliveryId) {
      await markDeliveryResult({ db: input.db, deliveryId, status: 'failed', error });
    }
    return { ok: false, ...(deliveryId ? { deliveryId } : {}), error, retryable };
  }
}

async function linkedSlackUserId(db: Db, teamId: string, userId: string): Promise<string | null> {
  const rows = await db
    .select({ slackUserId: slackUsers.slackUserId })
    .from(slackUserTeams)
    .innerJoin(slackUsers, eq(slackUsers.id, slackUserTeams.slackUserId))
    .where(and(eq(slackUserTeams.teamId, teamId), eq(slackUserTeams.userId, userId)))
    .limit(1);
  return rows[0]?.slackUserId ?? null;
}

async function linkedTelegramChatId(
  db: Db,
  teamId: string,
  userId: string,
): Promise<number | null> {
  const rows = await db
    .select({ tgUserId: telegramUsers.tgUserId })
    .from(telegramUserTeams)
    .innerJoin(telegramUsers, eq(telegramUserTeams.telegramUserId, telegramUsers.id))
    .where(and(eq(telegramUserTeams.teamId, teamId), eq(telegramUsers.userId, userId)))
    .limit(1);
  return rows[0]?.tgUserId ?? null;
}
