import {
  type Db,
  teams,
  integrations as integrationsTable,
  integrationWebhookDeliveries,
  integrationWebhookDeliveryTargets,
} from '@timeline/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { IntegrationRow, NativeProviderId } from '#src/integrations/types.js';

type WebhookDeliveryRow = typeof integrationWebhookDeliveries.$inferSelect;
type WebhookDeliveryTargetRow = typeof integrationWebhookDeliveryTargets.$inferSelect;

type WebhookDeliveryStatus =
  'accepted' | 'processing' | 'processed' | 'ignored' | 'failed' | 'dead_lettered';

type WebhookDeliveryTargetStatus =
  'pending' | 'processing' | 'processed' | 'ignored' | 'failed' | 'dead_lettered';

export interface WebhookDeliveryTargetInput {
  teamId: string;
  integrationId: string;
  providerConnectionId?: string | null;
}

export interface RecordWebhookDeliveryInput {
  provider: NativeProviderId;
  externalDeliveryId?: string | null;
  externalAccountId?: string | null;
  resourceKind?: string | null;
  externalResourceId?: string | null;
  eventType: string;
  action?: string | null;
  headers?: Record<string, unknown>;
  payload?: unknown;
  dedupKey: string;
  targets: WebhookDeliveryTargetInput[];
}

export interface RecordWebhookDeliveryResult {
  deliveryId: string | null;
  targetIds: string[];
}

export interface WebhookDeliveryTargetWork {
  target: WebhookDeliveryTargetRow;
  integration: IntegrationRow | null;
}

export interface WebhookDeliveryWork {
  delivery: WebhookDeliveryRow;
  targets: WebhookDeliveryTargetWork[];
}

export async function recordWebhookDeliveryTargets(
  db: Db,
  input: RecordWebhookDeliveryInput,
): Promise<RecordWebhookDeliveryResult> {
  return db.transaction(async (tx) => {
    if (!input.targets.length) return { deliveryId: null, targetIds: [] };
    // Lock admission through both inserts: a concurrent disable cannot leave an orphan payload.
    const activeTeams = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(
        and(
          inArray(
            teams.id,
            input.targets.map((target) => target.teamId),
          ),
          isNull(teams.disabledAt),
          isNull(teams.deletionStartedAt),
          sql`NOT EXISTS (SELECT 1 FROM team_billing_accounts b WHERE b.team_id = ${teams.id} AND b.security_state IN ('suspended', 'terminated'))`,
        ),
      )
      .for('share');
    const activeIds = new Set(activeTeams.map((team) => team.id));
    const targets = input.targets.filter((target) => activeIds.has(target.teamId));
    if (!targets.length) return { deliveryId: null, targetIds: [] };
    const deliveryRows = await tx
      .insert(integrationWebhookDeliveries)
      .values({
        provider: input.provider,
        externalDeliveryId: input.externalDeliveryId ?? null,
        externalAccountId: input.externalAccountId ?? null,
        resourceKind: input.resourceKind ?? null,
        externalResourceId: input.externalResourceId ?? null,
        eventType: input.eventType,
        action: input.action ?? null,
        headers: input.headers ?? {},
        payload: input.payload ?? {},
        dedupKey: input.dedupKey,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [integrationWebhookDeliveries.provider, integrationWebhookDeliveries.dedupKey],
        set: {
          updatedAt: new Date(),
        },
      })
      .returning({ id: integrationWebhookDeliveries.id });
    const deliveryId = deliveryRows[0]?.id;
    if (!deliveryId) throw new Error('webhook_delivery_insert_failed');
    if (targets.length === 0) return { deliveryId, targetIds: [] };

    const targetRows = await tx
      .insert(integrationWebhookDeliveryTargets)
      .values(
        targets.map((target) => ({
          deliveryId,
          teamId: target.teamId,
          integrationId: target.integrationId,
          providerConnectionId: target.providerConnectionId ?? null,
          updatedAt: new Date(),
        })),
      )
      .onConflictDoNothing({
        target: [
          integrationWebhookDeliveryTargets.deliveryId,
          integrationWebhookDeliveryTargets.integrationId,
        ],
      })
      .returning({ id: integrationWebhookDeliveryTargets.id });

    return {
      deliveryId,
      targetIds: targetRows.map((row) => row.id),
    };
  });
}

export async function loadWebhookDeliveryWork(
  db: Db,
  deliveryId: string,
): Promise<WebhookDeliveryWork | null> {
  const deliveryRows = await db
    .select()
    .from(integrationWebhookDeliveries)
    .where(eq(integrationWebhookDeliveries.id, deliveryId))
    .limit(1);
  const delivery = deliveryRows[0];
  if (!delivery) return null;

  const targetRows = await db
    .select({
      target: integrationWebhookDeliveryTargets,
      integration: integrationsTable,
    })
    .from(integrationWebhookDeliveryTargets)
    .leftJoin(
      integrationsTable,
      eq(integrationWebhookDeliveryTargets.integrationId, integrationsTable.id),
    )
    .where(
      and(
        eq(integrationWebhookDeliveryTargets.deliveryId, deliveryId),
        inArray(integrationWebhookDeliveryTargets.status, ['pending', 'failed']),
      ),
    );

  return { delivery, targets: targetRows };
}

export async function markWebhookDeliveryStatus(
  db: Db,
  deliveryId: string,
  status: WebhookDeliveryStatus,
  lastError?: string | null,
): Promise<void> {
  await db
    .update(integrationWebhookDeliveries)
    .set({
      status,
      lastError: lastError ?? null,
      updatedAt: new Date(),
    })
    .where(eq(integrationWebhookDeliveries.id, deliveryId));
}

export async function markWebhookDeliveryTargetProcessing(db: Db, targetId: string): Promise<void> {
  await db
    .update(integrationWebhookDeliveryTargets)
    .set({
      status: 'processing',
      attempts: sql`${integrationWebhookDeliveryTargets.attempts} + 1`,
      lastError: null,
      nextAttemptAt: null,
      updatedAt: new Date(),
    })
    .where(eq(integrationWebhookDeliveryTargets.id, targetId));
}

export async function markWebhookDeliveryTargetProcessed(
  db: Db,
  targetId: string,
  input: { eventDedupKeys?: string[]; syncJobId?: string | null } = {},
): Promise<void> {
  await markWebhookDeliveryTargetDone(db, targetId, 'processed', {
    eventDedupKeys: input.eventDedupKeys ?? [],
    syncJobId: input.syncJobId ?? null,
  });
}

export async function markWebhookDeliveryTargetIgnored(
  db: Db,
  targetId: string,
  reason: string,
): Promise<void> {
  await markWebhookDeliveryTargetDone(db, targetId, 'ignored', { lastError: reason });
}

export async function markWebhookDeliveryTargetFailed(
  db: Db,
  targetId: string,
  error: string,
): Promise<void> {
  await db
    .update(integrationWebhookDeliveryTargets)
    .set({
      status: 'failed',
      lastError: error.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(integrationWebhookDeliveryTargets.id, targetId));
}

export async function markWebhookDeliveryDeadLettered(
  db: Db,
  deliveryId: string,
  error: string,
): Promise<void> {
  const lastError = error.slice(0, 500);
  await db.transaction(async (tx) => {
    await tx
      .update(integrationWebhookDeliveries)
      .set({
        status: 'dead_lettered',
        lastError,
        updatedAt: new Date(),
      })
      .where(eq(integrationWebhookDeliveries.id, deliveryId));
    await tx
      .update(integrationWebhookDeliveryTargets)
      .set({
        status: 'dead_lettered',
        lastError,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationWebhookDeliveryTargets.deliveryId, deliveryId),
          inArray(integrationWebhookDeliveryTargets.status, ['pending', 'processing', 'failed']),
        ),
      );
  });
}

async function markWebhookDeliveryTargetDone(
  db: Db,
  targetId: string,
  status: WebhookDeliveryTargetStatus,
  input: {
    eventDedupKeys?: string[] | null;
    syncJobId?: string | null;
    lastError?: string | null;
  },
): Promise<void> {
  await db
    .update(integrationWebhookDeliveryTargets)
    .set({
      status,
      eventDedupKeys: input.eventDedupKeys ?? null,
      syncJobId: input.syncJobId ?? null,
      lastError: input.lastError ?? null,
      updatedAt: new Date(),
    })
    .where(eq(integrationWebhookDeliveryTargets.id, targetId));
}
