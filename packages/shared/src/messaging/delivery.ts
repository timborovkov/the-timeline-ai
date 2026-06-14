import { type Db, dailyDigests, messageDeliveries } from '@timeline/db';
import { eq } from 'drizzle-orm';

import type {
  MessageChannel,
  MessageDeliveryStatus,
  MessageInput,
  MessageIntent,
  RenderedMessage,
  SendMessageResult,
} from '#src/messaging/types.js';

import { getEnv } from '#src/env.js';
import { renderMessage } from '#src/messaging/templates.js';

interface PostmarkResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
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
  return env.TRANSACTIONAL_EMAIL_FROM ?? null;
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
    return { ok: false, error: 'Outbound email is not configured' };
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
      return { ok: false, error: detail.slice(0, 500) };
    }
    return {
      ok: true,
      ...(body?.MessageID ? { providerMessageId: body.MessageID } : {}),
    };
  } catch (err) {
    return { ok: false, error: shortError(err, 'Failed to send email') };
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
      return { ok: true, deliveryId: existing.id, skipped: true };
    }
    if (existing) {
      deliveryId = existing.id;
      await markDeliveryResult({ db: options.db, deliveryId, status: 'pending' });
    }
  }

  if (channel === 'in_app_digest') {
    if (deliveryId && options.db) {
      await markDeliveryResult({ db: options.db, deliveryId, status: 'sent' });
    }
    return { ok: true, ...(deliveryId ? { deliveryId } : {}) };
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
  };
}

export async function sendDailyDigest(input: {
  db: Db;
  digestId: string;
  to: string;
  digestUrl: string;
  fetch?: typeof globalThis.fetch;
}): Promise<SendMessageResult> {
  const rows = await input.db
    .select()
    .from(dailyDigests)
    .where(eq(dailyDigests.id, input.digestId))
    .limit(1);
  const digest = rows[0];
  if (!digest) return { ok: false, error: 'Digest not found' };
  const payload = digest.payload as Parameters<typeof sendMessage<'daily_digest'>>[1]['payload'];
  const result = await sendMessage(
    'daily_digest',
    { to: input.to, digestUrl: input.digestUrl, payload },
    {
      db: input.db,
      teamId: digest.teamId,
      userId: digest.userId,
      dedupeKey: `daily_digest:${digest.id}`,
      ...(input.fetch ? { fetch: input.fetch } : {}),
    },
  );
  const digestUpdate = result.skipped
    ? {
        status: 'sent' as const,
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

export const messagingInternals = { sendPostmarkEmail };
