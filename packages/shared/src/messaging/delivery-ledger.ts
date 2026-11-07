import { type Db, messageDeliveries } from '@timeline/db';
import { and, eq, lt } from 'drizzle-orm';
import type {
  MessageChannel,
  MessageDeliveryStatus,
  MessageIntent,
  SendMessageResult,
} from '#src/messaging/types.js';

const PENDING_DELIVERY_RETRY_AFTER_MS = 30_000;

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
}): Promise<{ id: string; status: MessageDeliveryStatus; metadata: unknown } | null> {
  const rows = await input.db
    .select({
      id: messageDeliveries.id,
      status: messageDeliveries.status,
      metadata: messageDeliveries.metadata,
    })
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

export type DeliveryClaim =
  | { kind: 'claimed'; deliveryId: string | null; previous?: { id: string; metadata: unknown } }
  | { kind: 'already_sent' | 'pending' | 'skipped'; result: SendMessageResult };

export async function claimDelivery(
  input: Parameters<typeof recordDelivery>[0],
): Promise<DeliveryClaim> {
  const deliveryId = await recordDelivery(input);
  if (deliveryId || !input.dedupeKey) return { kind: 'claimed', deliveryId };
  const existing = await findDeliveryByDedupeKey({ db: input.db, dedupeKey: input.dedupeKey });
  if (!existing) return { kind: 'claimed', deliveryId: null };
  if (existing.status === 'sent') {
    return {
      kind: 'already_sent',
      result: { ok: true, deliveryId: existing.id, skipped: true, skippedStatus: 'sent' },
    };
  }
  if (existing.status !== 'failed' && existing.status !== 'pending') {
    return {
      kind: 'skipped',
      result: { ok: true, deliveryId: existing.id, skipped: true, skippedStatus: existing.status },
    };
  }
  const claimed =
    existing.status === 'failed'
      ? await claimFailedDeliveryForRetry({ db: input.db, deliveryId: existing.id })
      : await claimStalePendingDeliveryForRetry({
          db: input.db,
          deliveryId: existing.id,
          staleBefore: new Date(Date.now() - PENDING_DELIVERY_RETRY_AFTER_MS),
        });
  if (!claimed) {
    return {
      kind: 'pending',
      result: {
        ok: false,
        deliveryId: existing.id,
        skipped: true,
        skippedStatus: 'pending',
        error: 'Delivery is already pending.',
      },
    };
  }
  return { kind: 'claimed', deliveryId: existing.id, previous: existing };
}
