import {
  type Db,
  dailyDigests,
  messageDeliveries,
  messagePreferences,
  slackUsers,
  slackUserTeams,
  teamMembers,
  telegramUsers,
  telegramUserTeams,
  users,
} from '@timeline/db';
import { and, eq, isNull, lt } from 'drizzle-orm';

import type {
  DailyDigestPayload,
  MessageChannel,
  MessageDeliveryStatus,
  MessageInput,
  MessageIntent,
  RenderedMessage,
  SendMessageResult,
} from '#src/messaging/types.js';

import { emailRecipientCount } from '#src/billing/catalog.js';
import { getEnv } from '#src/env.js';
import {
  digestDestinationDedupeKey,
  listTeamDigestDestinations,
  personalDigestDestinations,
  sharedDigestDestinations,
  type TeamDigestDestination,
} from '#src/messaging/destinations.js';
import { formatDigestChatText } from '#src/messaging/digest-format.js';
import {
  generateDailyDigest,
  getDigestPreference,
  isDigestWindowExpired,
} from '#src/messaging/digest.js';
import { renderMessage } from '#src/messaging/templates.js';
import { sendTeamSlackDirectMessage, sendTeamSlackMessage } from '#src/slack/dispatcher.js';
import { sendTelegramBotMessage } from '#src/telegram/api.js';

interface PostmarkResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
  retryable?: boolean;
}

const PENDING_DELIVERY_RETRY_AFTER_MS = 30_000;

/** Postmark 406 + matching copy: hard bounce / spam complaint / manual suppression. */
function isInactiveRecipientFailure(errorCode: number | undefined, message: string): boolean {
  if (errorCode === 406) return true;
  return /marked as inactive|inactive (addresses|recipients)/i.test(message);
}

/** Terminal send-input failures; retries cannot help until config/content changes. */
const PERMANENT_POSTMARK_ERROR_CODES = new Set([
  300, // Invalid email request
  400, // Sender Signature not found
  401, // Sender signature not confirmed
  402, // Invalid JSON
  403, // Invalid request field(s)
  406, // Inactive recipient
  409, // JSON required
  411, // Forbidden attachment type
  412, // Account pending approval
  413, // Account may not send
]);

/**
 * Classify Postmark send failures for BullMQ retry policy.
 * Permanent: inactive recipients and other terminal input/config ErrorCodes.
 * Retryable: credits (405), rate limits (429), 5xx, network, and unknown 422s.
 */
function isRetryablePostmarkFailure(input: {
  status: number;
  errorCode?: number;
  message: string;
}): boolean {
  if (isInactiveRecipientFailure(input.errorCode, input.message)) return false;
  if (typeof input.errorCode === 'number' && PERMANENT_POSTMARK_ERROR_CODES.has(input.errorCode)) {
    return false;
  }
  if (input.status === 401 || input.status === 403 || input.status === 404) return false;
  return true;
}

export interface SendMessageOptions {
  db?: Db;
  channel?: MessageChannel;
  teamId?: string | null;
  userId?: string | null;
  dedupeKey?: string;
  metadata?: Record<string, unknown>;
  fetch?: typeof globalThis.fetch;
}

function configuredSender(): string | null {
  const env = getEnv();
  return env.TRANSACTIONAL_EMAIL_FROM ?? env.INVITE_EMAIL_FROM ?? null;
}

function shortError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message.slice(0, 500);
  return fallback;
}

async function sendPostmarkEmail(
  message: RenderedMessage,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<PostmarkResult> {
  const env = getEnv();
  const from = configuredSender();
  if (!env.POSTMARK_SERVER_TOKEN || !from) {
    return { ok: false, error: 'Outbound email is not configured', retryable: false };
  }

  try {
    const res = await fetchImpl('https://api.postmarkapp.com/email', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': env.POSTMARK_SERVER_TOKEN,
      },
      body: JSON.stringify({
        From: from,
        To: message.to,
        ReplyTo: message.replyTo,
        Subject: message.subject,
        TextBody: message.textBody,
        HtmlBody: message.htmlBody,
        MessageStream: 'outbound',
        Metadata: message.metadata,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      Message?: string;
      MessageID?: string;
      ErrorCode?: number;
    } | null;
    if (!res.ok) {
      const detail = body?.Message ?? `${res.status} ${res.statusText}`.trim();
      const error = detail.slice(0, 500);
      return {
        ok: false,
        error,
        retryable: isRetryablePostmarkFailure({
          status: res.status,
          ...(typeof body?.ErrorCode === 'number' ? { errorCode: body.ErrorCode } : {}),
          message: error,
        }),
      };
    }
    return {
      ok: true,
      ...(body?.MessageID ? { providerMessageId: body.MessageID } : {}),
    };
  } catch (err) {
    return { ok: false, error: shortError(err, 'Failed to send email'), retryable: true };
  }
}

export async function recordDelivery(input: {
  db: Db;
  intent: MessageIntent;
  channel: MessageChannel;
  teamId?: string | null;
  userId?: string | null;
  recipientEmail?: string | null;
  subject?: string | null;
  status?: MessageDeliveryStatus;
  provider?: string | null;
  dedupeKey?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<string | null> {
  const [row] = await input.db
    .insert(messageDeliveries)
    .values({
      intent: input.intent,
      channel: input.channel,
      teamId: input.teamId ?? null,
      userId: input.userId ?? null,
      recipientEmail: input.recipientEmail ?? null,
      subject: input.subject ?? null,
      status: input.status ?? 'pending',
      provider: input.provider ?? null,
      dedupeKey: input.dedupeKey ?? null,
      metadata: input.metadata ?? {},
    })
    .onConflictDoNothing()
    .returning({ id: messageDeliveries.id });
  return row?.id ?? null;
}

async function findDeliveryByDedupeKey(input: {
  db: Db;
  dedupeKey: string;
}): Promise<{ id: string; status: MessageDeliveryStatus } | null> {
  const rows = await input.db
    .select({ id: messageDeliveries.id, status: messageDeliveries.status })
    .from(messageDeliveries)
    .where(eq(messageDeliveries.dedupeKey, input.dedupeKey))
    .limit(1);
  return rows[0] ?? null;
}

async function claimFailedDeliveryForRetry(input: {
  db: Db;
  deliveryId: string;
}): Promise<boolean> {
  const rows = await input.db
    .update(messageDeliveries)
    .set({
      status: 'pending',
      providerMessageId: null,
      error: null,
      sentAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(messageDeliveries.id, input.deliveryId), eq(messageDeliveries.status, 'failed')))
    .returning({ id: messageDeliveries.id });
  return rows.length > 0;
}

async function claimStalePendingDeliveryForRetry(input: {
  db: Db;
  deliveryId: string;
  staleBefore: Date;
}): Promise<boolean> {
  const rows = await input.db
    .update(messageDeliveries)
    .set({
      status: 'pending',
      providerMessageId: null,
      error: null,
      sentAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(messageDeliveries.id, input.deliveryId),
        eq(messageDeliveries.status, 'pending'),
        lt(messageDeliveries.updatedAt, input.staleBefore),
      ),
    )
    .returning({ id: messageDeliveries.id });
  return rows.length > 0;
}

export async function markDeliveryResult(input: {
  db: Db;
  deliveryId: string;
  status: MessageDeliveryStatus;
  providerMessageId?: string | null;
  error?: string | null;
}): Promise<void> {
  await input.db
    .update(messageDeliveries)
    .set({
      status: input.status,
      providerMessageId: input.providerMessageId ?? null,
      error: input.error ?? null,
      sentAt: input.status === 'sent' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(messageDeliveries.id, input.deliveryId));
}

export async function sendMessage<TIntent extends MessageIntent>(
  intent: TIntent,
  messageInput: MessageInput<TIntent>,
  options: SendMessageOptions = {},
): Promise<SendMessageResult> {
  const channel = options.channel ?? 'email';
  const rendered = renderMessage(intent, messageInput);
  let deliveryId = options.db
    ? await recordDelivery({
        db: options.db,
        intent,
        channel,
        teamId: options.teamId ?? null,
        userId: options.userId ?? null,
        recipientEmail: rendered.to,
        subject: rendered.subject,
        status: 'pending',
        provider: channel === 'email' ? 'postmark' : null,
        dedupeKey: options.dedupeKey ?? null,
        metadata: {
          ...(options.metadata ?? {}),
          ...(rendered.previewText ? { previewText: rendered.previewText } : {}),
        },
      })
    : null;

  if (options.db && options.dedupeKey && !deliveryId) {
    const existing = await findDeliveryByDedupeKey({
      db: options.db,
      dedupeKey: options.dedupeKey,
    });
    if (existing?.status === 'sent') {
      return { ok: true, deliveryId: existing.id, skipped: true, skippedStatus: 'sent' };
    }
    if (existing?.status === 'failed') {
      const claimed = await claimFailedDeliveryForRetry({
        db: options.db,
        deliveryId: existing.id,
      });
      if (!claimed) {
        return {
          ok: false,
          deliveryId: existing.id,
          skipped: true,
          skippedStatus: 'pending',
          error: 'Delivery is already pending.',
        };
      }
      deliveryId = existing.id;
    } else if (existing?.status === 'pending') {
      const claimed = await claimStalePendingDeliveryForRetry({
        db: options.db,
        deliveryId: existing.id,
        staleBefore: new Date(Date.now() - PENDING_DELIVERY_RETRY_AFTER_MS),
      });
      if (!claimed) {
        return {
          ok: false,
          deliveryId: existing.id,
          skipped: true,
          skippedStatus: 'pending',
          error: 'Delivery is already pending.',
        };
      }
      deliveryId = existing.id;
    } else if (existing) {
      return { ok: true, deliveryId: existing.id, skipped: true, skippedStatus: existing.status };
    }
  }

  if (channel === 'in_app_digest') {
    if (deliveryId && options.db) {
      await markDeliveryResult({ db: options.db, deliveryId, status: 'sent' });
    }
    return { ok: true, ...(deliveryId ? { deliveryId } : {}) };
  }

  const shouldMeterEmail =
    Boolean(options.db && options.teamId) && intent !== 'billing_usage_alert';
  const units = Math.max(1, emailRecipientCount(rendered.to));
  const operationKey = options.dedupeKey ?? `${intent}:${rendered.to}`;
  const emailOperationId = `email_out:${operationKey}`;
  if (shouldMeterEmail && options.db && options.teamId) {
    const { reserveEmailUnits, releaseEmailUnits, settleEmailUnits } =
      await import('#src/billing/runtime.js');
    const reserved = await reserveEmailUnits({
      db: options.db,
      teamId: options.teamId,
      ...(options.userId ? { userId: options.userId } : {}),
      operationId: emailOperationId,
      units,
    });
    if (!reserved.ok) {
      if (deliveryId) {
        await markDeliveryResult({
          db: options.db,
          deliveryId,
          status: 'failed',
          error: 'email_meter_admission_failed',
        });
      }
      return {
        ok: false,
        ...(deliveryId ? { deliveryId } : {}),
        error: 'Email usage limit reached for this workspace.',
        retryable: false,
      };
    }
    const result = reserved.alreadySettled
      ? { ok: true as const }
      : await sendPostmarkEmail(rendered, options.fetch);
    if (result.ok) {
      await settleEmailUnits({
        db: options.db,
        teamId: options.teamId,
        ...(options.userId ? { userId: options.userId } : {}),
        operationId: emailOperationId,
        units,
        operationClass: `email_outbound:${intent}`,
      });
    } else {
      await releaseEmailUnits({
        db: options.db,
        teamId: options.teamId,
        ...(options.userId ? { userId: options.userId } : {}),
        operationId: emailOperationId,
      });
    }
    if (deliveryId) {
      await markDeliveryResult({
        db: options.db,
        deliveryId,
        status: result.ok ? 'sent' : 'failed',
        ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
        ...(result.error ? { error: result.error } : {}),
      });
    }
    return {
      ok: result.ok,
      ...(deliveryId ? { deliveryId } : {}),
      ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(result.ok ? {} : { retryable: result.retryable ?? true }),
    };
  }

  const result = await sendPostmarkEmail(rendered, options.fetch);
  if (deliveryId && options.db) {
    await markDeliveryResult({
      db: options.db,
      deliveryId,
      status: result.ok ? 'sent' : 'failed',
      ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
      ...(result.error ? { error: result.error } : {}),
    });
  }
  return {
    ok: result.ok,
    ...(deliveryId ? { deliveryId } : {}),
    ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(result.ok ? {} : { retryable: result.retryable ?? true }),
  };
}

export async function sendDailyDigest(input: {
  db: Db;
  digestId: string;
  to: string;
  digestUrl: string;
  fetch?: typeof globalThis.fetch;
  now?: Date;
}): Promise<SendMessageResult> {
  const rows = await input.db
    .select()
    .from(dailyDigests)
    .where(eq(dailyDigests.id, input.digestId))
    .limit(1);
  const digest = rows[0];
  if (!digest) return { ok: false, error: 'Digest not found', retryable: false };
  const recipientRows = await input.db
    .select({
      email: users.email,
      removedAt: teamMembers.removedAt,
      dailyDigestEnabled: messagePreferences.dailyDigestEnabled,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
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
  if (!recipient || recipient.dailyDigestEnabled === false) {
    await input.db
      .update(dailyDigests)
      .set({
        status: 'skipped',
        error: recipient ? 'Daily digest is disabled.' : 'Recipient is no longer a team member.',
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
  fetch?: typeof globalThis.fetch;
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
    send: () => sendTelegramBotMessage({ chatId: telegramChatId, text, token }),
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
    send: () => sendTelegramBotMessage({ chatId, text, token }),
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
  let deliveryId = await recordDelivery({
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
  if (!deliveryId) {
    const existing = await findDeliveryByDedupeKey({ db: input.db, dedupeKey: input.dedupeKey });
    if (existing?.status === 'sent') {
      return { ok: true, deliveryId: existing.id, skipped: true, skippedStatus: 'sent' };
    }
    if (existing?.status === 'failed') {
      const claimed = await claimFailedDeliveryForRetry({
        db: input.db,
        deliveryId: existing.id,
      });
      if (!claimed) {
        return {
          ok: false,
          deliveryId: existing.id,
          skipped: true,
          skippedStatus: 'pending',
          error: 'Delivery is already pending.',
        };
      }
      deliveryId = existing.id;
    } else if (existing?.status === 'pending') {
      const claimed = await claimStalePendingDeliveryForRetry({
        db: input.db,
        deliveryId: existing.id,
        staleBefore: new Date(Date.now() - PENDING_DELIVERY_RETRY_AFTER_MS),
      });
      if (!claimed) {
        return {
          ok: false,
          deliveryId: existing.id,
          skipped: true,
          skippedStatus: 'pending',
          error: 'Delivery is already pending.',
        };
      }
      deliveryId = existing.id;
    } else if (existing) {
      return { ok: true, deliveryId: existing.id, skipped: true, skippedStatus: existing.status };
    }
  }
  try {
    await input.send();
    if (deliveryId) {
      await markDeliveryResult({ db: input.db, deliveryId, status: 'sent' });
    }
    return { ok: true, ...(deliveryId ? { deliveryId } : {}) };
  } catch (err) {
    const error = shortError(err, 'Failed to send digest');
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

export const messagingInternals = { sendPostmarkEmail };
