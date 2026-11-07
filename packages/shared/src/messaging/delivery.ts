import { claimDelivery, markDeliveryResult } from '#src/messaging/delivery-ledger.js';
export { recordDelivery, markDeliveryResult } from '#src/messaging/delivery-ledger.js';
import { createHash } from 'node:crypto';
import { type Db } from '@timeline/db';
import { z } from 'zod';
import { emailRecipientCount } from '#src/billing/catalog.js';
import { decryptJson, encryptJson } from '#src/crypto/secrets.js';
import { resendRequest, ResendError, type EmailFetch } from '#src/email/resend-client.js';
import { getEnv } from '#src/env.js';
import { childLogger } from '#src/logger.js';
import { renderMessage } from '#src/messaging/templates.js';
import type {
  MessageChannel,
  MessageInput,
  MessageIntent,
  RenderedMessage,
  SendMessageResult,
} from '#src/messaging/types.js';

interface ResendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
  retryable?: boolean;
  retryAfterMs?: number;
}

const log = childLogger('messaging:delivery');

export interface SendMessageOptions {
  db?: Db;
  channel?: MessageChannel;
  teamId?: string | null;
  userId?: string | null;
  dedupeKey?: string;
  metadata?: Record<string, unknown>;
  fetch?: (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>;
}

function configuredSender(): string | null {
  const env = getEnv();
  return env.TRANSACTIONAL_EMAIL_FROM ?? null;
}

const sendPayloadSchema = z.object({
  from: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  text: z.string(),
  html: z.string(),
  reply_to: z.string().optional(),
  tags: z.array(z.object({ name: z.string(), value: z.string() })),
});
type SendPayload = z.infer<typeof sendPayloadSchema>;
function resendPayload(message: RenderedMessage): SendPayload {
  return {
    from: configuredSender() ?? '',
    to: message.to
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    subject: message.subject,
    text: message.textBody,
    html: message.htmlBody,
    ...(message.replyTo ? { reply_to: message.replyTo } : {}),
    tags: Object.entries(message.metadata ?? {})
      .filter(
        ([name, value]) =>
          /^[A-Za-z0-9_-]{1,256}$/.test(name) && /^[A-Za-z0-9_-]{1,256}$/.test(value),
      )
      .slice(0, 10)
      .map(([name, value]) => ({ name, value })),
  };
}
async function sendResendEmail(
  message: RenderedMessage,
  fetchImpl: EmailFetch = globalThis.fetch,
  deliveryKey?: string,
  payload: SendPayload = resendPayload(message),
): Promise<ResendResult> {
  if (!getEnv().RESEND_API_KEY || !payload.from)
    return { ok: false, error: 'Outbound email is not configured', retryable: false };
  try {
    const response = z.object({ id: z.string().min(1) }).parse(
      await resendRequest(
        '/emails',
        {
          method: 'POST',
          body: JSON.stringify(payload),
          ...(deliveryKey
            ? {
                headers: {
                  'Idempotency-Key': `timeline-${createHash('sha256').update(deliveryKey).digest('hex')}`,
                },
              }
            : {}),
        },
        fetchImpl,
      ),
    );
    return { ok: true, providerMessageId: response.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof ResendError ? error.message : 'Invalid Resend response',
      retryable: error instanceof ResendError ? error.retryable : true,
      ...(error instanceof ResendError && error.retryAfterMs
        ? { retryAfterMs: error.retryAfterMs }
        : {}),
    };
  }
}

const UNMETERED_WORKSPACE_EMAIL_INTENTS = new Set<MessageIntent>([
  'billing_usage_alert',
  'email_verification',
  'password_reset',
  'support_request',
]);

/**
 * Verification mail, billing alerts, and support requests must send even when
 * the workspace is restricted, past due, read-only, or out of email allowance.
 */
export function shouldMeterWorkspaceEmail(
  intent: MessageIntent,
  options: { db?: unknown; teamId?: string | null },
): boolean {
  return Boolean(options.db && options.teamId) && !UNMETERED_WORKSPACE_EMAIL_INTENTS.has(intent);
}

async function settleMeteredEmailBestEffort(input: {
  intent: MessageIntent;
  options: SendMessageOptions;
  units: number;
  operationId: string;
}): Promise<void> {
  if (!shouldMeterWorkspaceEmail(input.intent, input.options)) return;
  const db = input.options.db;
  const teamId = input.options.teamId;
  if (!db || !teamId) return;
  const { settleEmailUnits } = await import('#src/billing/runtime.js');
  try {
    await settleEmailUnits({
      db,
      teamId,
      ...(input.options.userId ? { userId: input.options.userId } : {}),
      operationId: input.operationId,
      units: input.units,
      operationClass: `email_outbound:${input.intent}`,
    });
  } catch (err) {
    log.warn(
      { err, teamId, operationId: input.operationId },
      'resend sent; email billing settle failed',
    );
  }
}

function secretBearingIntent(intent: MessageIntent): boolean {
  return intent === 'email_verification' || intent === 'team_invite' || intent === 'password_reset';
}

function persistedEmailPayload(intent: MessageIntent, payload: z.infer<typeof sendPayloadSchema>) {
  if (!secretBearingIntent(intent)) return { email_payload: payload };
  const encrypted = encryptJson(payload);
  return {
    email_payload_encrypted: {
      ciphertext: encrypted.ciphertext.toString('base64'),
      iv: encrypted.iv.toString('base64'),
      tag: encrypted.tag.toString('base64'),
    },
  };
}

function readPersistedEmailPayload(intent: MessageIntent, metadata: unknown) {
  if (!secretBearingIntent(intent)) {
    return z.object({ email_payload: sendPayloadSchema }).parse(metadata).email_payload;
  }
  const encrypted = z
    .object({
      email_payload_encrypted: z.object({
        ciphertext: z.string(),
        iv: z.string(),
        tag: z.string(),
      }),
    })
    .parse(metadata).email_payload_encrypted;
  return sendPayloadSchema.parse(
    decryptJson({
      ciphertext: Buffer.from(encrypted.ciphertext, 'base64'),
      iv: Buffer.from(encrypted.iv, 'base64'),
      tag: Buffer.from(encrypted.tag, 'base64'),
    }),
  );
}

export async function sendMessage<TIntent extends MessageIntent>(
  intent: TIntent,
  messageInput: MessageInput<TIntent>,
  options: SendMessageOptions = {},
): Promise<SendMessageResult> {
  const channel = options.channel ?? 'email';
  const rendered = renderMessage(intent, messageInput);
  let payload = resendPayload(rendered);
  const claim = options.db
    ? await claimDelivery({
        db: options.db,
        intent,
        channel,
        teamId: options.teamId ?? null,
        userId: options.userId ?? null,
        recipientEmail: rendered.to,
        subject: rendered.subject,
        status: 'pending',
        provider: channel === 'email' ? 'resend' : null,
        dedupeKey: options.dedupeKey ?? null,
        metadata: {
          ...(options.metadata ?? {}),
          ...persistedEmailPayload(intent, payload),
          template_metadata: rendered.metadata ?? {},
          ...(rendered.previewText ? { previewText: rendered.previewText } : {}),
        },
      })
    : { kind: 'claimed' as const, deliveryId: null };

  if (claim.kind !== 'claimed') {
    if (claim.kind === 'already_sent') {
      const units = Math.max(1, emailRecipientCount(payload.to.join(',')));
      const operationKey = options.dedupeKey ?? `${intent}:${rendered.to}`;
      await settleMeteredEmailBestEffort({
        intent,
        options,
        units,
        operationId: `email_out:${operationKey}`,
      });
    }
    return claim.result;
  }
  const deliveryId = claim.deliveryId;
  if (options.db && claim.previous) {
    const existing = claim.previous;

    try {
      payload = readPersistedEmailPayload(intent, existing.metadata);
    } catch {
      await markDeliveryResult({
        db: options.db,
        deliveryId: existing.id,
        status: 'failed',
        error: 'Stored email payload is invalid',
      });
      return {
        ok: false,
        deliveryId: existing.id,
        error: 'Stored email payload is invalid',
        retryable: false,
      };
    }
  }

  if (channel === 'in_app_digest') {
    if (deliveryId && options.db) {
      await markDeliveryResult({ db: options.db, deliveryId, status: 'sent' });
    }
    return { ok: true, ...(deliveryId ? { deliveryId } : {}) };
  }

  const shouldMeterEmail = shouldMeterWorkspaceEmail(intent, options);
  const units = Math.max(1, emailRecipientCount(payload.to.join(',')));
  const operationKey = options.dedupeKey ?? `${intent}:${rendered.to}`;
  const emailOperationId = `email_out:${operationKey}`;
  if (shouldMeterEmail && options.db && options.teamId) {
    const { reserveEmailUnits, releaseEmailUnits } = await import('#src/billing/runtime.js');
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
      : await sendResendEmail(rendered, options.fetch, deliveryId ?? options.dedupeKey, payload);
    if (result.ok) {
      if (deliveryId) {
        await markDeliveryResult({
          db: options.db,
          deliveryId,
          status: 'sent',
          ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
        });
      }
      await settleMeteredEmailBestEffort({
        intent,
        options,
        units,
        operationId: emailOperationId,
      });
    } else {
      await releaseEmailUnits({
        db: options.db,
        teamId: options.teamId,
        ...(options.userId ? { userId: options.userId } : {}),
        operationId: emailOperationId,
      });
      if (deliveryId) {
        await markDeliveryResult({
          db: options.db,
          deliveryId,
          status: 'failed',
          ...(result.error ? { error: result.error } : {}),
        });
      }
    }
    return {
      ok: result.ok,
      ...(deliveryId ? { deliveryId } : {}),
      ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(result.ok ? {} : { retryable: result.retryable ?? true }),
      ...(result.retryAfterMs ? { retryAfterMs: result.retryAfterMs } : {}),
    };
  }

  const result = await sendResendEmail(
    rendered,
    options.fetch,
    deliveryId ?? options.dedupeKey,
    payload,
  );
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
    ...(result.retryAfterMs ? { retryAfterMs: result.retryAfterMs } : {}),
  };
}

export const messagingInternals = { sendResendEmail };
