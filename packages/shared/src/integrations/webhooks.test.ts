import { PGlite } from '@electric-sql/pglite';
import {
  connectionAttention,
  integrationWebhookDeliveries,
  integrationWebhookDeliveryTargets,
  integrationWebhookSubscriptions,
  integrations,
  providerConnections,
  teams,
  users,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { adminReconcileExpiringWebhookSubscriptions } from '#src/integrations/scope.js';
import {
  loadWebhookDeliveryWork,
  markWebhookDeliveryDeadLettered,
  markWebhookDeliveryStatus,
  markWebhookDeliveryTargetProcessed,
  markWebhookDeliveryTargetProcessing,
  recordWebhookDeliveryTargets,
} from '#src/integrations/webhooks.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';
const INTEGRATION_ID = '44444444-4444-4444-8444-444444444444';
const DRIVE_CONNECTION_ID = '55555555-5555-4555-8555-555555555555';
const DRIVE_INTEGRATION_ID = '66666666-6666-4666-8666-666666666666';

describe('webhook delivery persistence', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await db.insert(teams).values({
      id: TEAM_ID,
      slug: 'webhook-team',
      name: 'Webhook Team',
    });
    await db.insert(users).values({
      id: USER_ID,
      email: 'owner@example.test',
    });
    await db.insert(providerConnections).values({
      id: CONNECTION_ID,
      ownerUserId: USER_ID,
      provider: 'linear',
      displayName: 'Linear',
      externalAccountId: 'org-1',
      authSecretCiphertext: Buffer.from('00', 'hex'),
      authSecretIv: Buffer.from('01', 'hex'),
      authSecretTag: Buffer.from('02', 'hex'),
    });
    await db.insert(integrations).values({
      id: INTEGRATION_ID,
      teamId: TEAM_ID,
      connectedByUserId: USER_ID,
      providerConnectionId: CONNECTION_ID,
      provider: 'linear',
      displayName: 'Linear',
      externalAccountId: 'org-1',
    });
  });

  afterEach(async () => {
    await pg.close();
  });

  it('records delivery targets and advances target lifecycle state', async () => {
    const recorded = await recordWebhookDeliveryTargets(db as never, {
      provider: 'linear',
      externalDeliveryId: 'delivery-1',
      externalAccountId: 'org-1',
      resourceKind: 'linear.team',
      externalResourceId: 'team-linear-1',
      eventType: 'Issue',
      payload: { type: 'Issue' },
      dedupKey: 'linear:delivery:delivery-1',
      targets: [
        {
          teamId: TEAM_ID,
          integrationId: INTEGRATION_ID,
          providerConnectionId: CONNECTION_ID,
        },
      ],
    });

    expect(recorded.targetIds).toHaveLength(1);
    const work = await loadWebhookDeliveryWork(db as never, recorded.deliveryId);
    expect(work?.delivery).toMatchObject({
      id: recorded.deliveryId,
      provider: 'linear',
      dedupKey: 'linear:delivery:delivery-1',
      status: 'accepted',
    });
    expect(work?.targets[0]?.integration?.id).toBe(INTEGRATION_ID);

    const targetId = recorded.targetIds[0];
    if (!targetId) throw new Error('target id missing');
    await markWebhookDeliveryTargetProcessing(db as never, targetId);
    let [target] = await db
      .select()
      .from(integrationWebhookDeliveryTargets)
      .where(eq(integrationWebhookDeliveryTargets.id, targetId));
    expect(target).toMatchObject({ status: 'processing', attempts: 1 });

    await markWebhookDeliveryTargetProcessed(db as never, targetId, {
      eventDedupKeys: ['linear:issue:1'],
    });
    [target] = await db
      .select()
      .from(integrationWebhookDeliveryTargets)
      .where(eq(integrationWebhookDeliveryTargets.id, targetId));
    expect(target).toMatchObject({
      status: 'processed',
      eventDedupKeys: ['linear:issue:1'],
    });

    await markWebhookDeliveryStatus(db as never, recorded.deliveryId, 'processed');
    const [delivery] = await db
      .select()
      .from(integrationWebhookDeliveries)
      .where(eq(integrationWebhookDeliveries.id, recorded.deliveryId));
    expect(delivery?.status).toBe('processed');
  });

  it('dead-letters the delivery and only unfinished targets', async () => {
    const recorded = await recordWebhookDeliveryTargets(db as never, {
      provider: 'linear',
      externalDeliveryId: 'delivery-2',
      externalAccountId: 'org-1',
      resourceKind: 'linear.team',
      externalResourceId: 'team-linear-1',
      eventType: 'Issue',
      payload: { type: 'Issue' },
      dedupKey: 'linear:delivery:delivery-2',
      targets: [
        {
          teamId: TEAM_ID,
          integrationId: INTEGRATION_ID,
          providerConnectionId: CONNECTION_ID,
        },
      ],
    });
    const targetId = recorded.targetIds[0];
    if (!targetId) throw new Error('target id missing');
    await markWebhookDeliveryTargetProcessing(db as never, targetId);

    await markWebhookDeliveryDeadLettered(
      db as never,
      recorded.deliveryId,
      'provider parse failed',
    );

    const [delivery] = await db
      .select()
      .from(integrationWebhookDeliveries)
      .where(eq(integrationWebhookDeliveries.id, recorded.deliveryId));
    expect(delivery).toMatchObject({
      status: 'dead_lettered',
      lastError: 'provider parse failed',
    });
    const [target] = await db
      .select()
      .from(integrationWebhookDeliveryTargets)
      .where(eq(integrationWebhookDeliveryTargets.id, targetId));
    expect(target).toMatchObject({
      status: 'dead_lettered',
      lastError: 'provider parse failed',
    });
  });

  it('marks expired manual Drive channels as webhook-degraded while reconciliation remains available', async () => {
    await db.insert(providerConnections).values({
      id: DRIVE_CONNECTION_ID,
      ownerUserId: USER_ID,
      provider: 'google_drive',
      displayName: 'Google Drive',
      externalAccountId: 'drive-account-1',
      authSecretCiphertext: Buffer.from('03', 'hex'),
      authSecretIv: Buffer.from('04', 'hex'),
      authSecretTag: Buffer.from('05', 'hex'),
    });
    await db.insert(integrations).values({
      id: DRIVE_INTEGRATION_ID,
      teamId: TEAM_ID,
      connectedByUserId: USER_ID,
      providerConnectionId: DRIVE_CONNECTION_ID,
      provider: 'google_drive',
      displayName: 'Google Drive',
      externalAccountId: 'drive-account-1',
    });
    await db.insert(integrationWebhookSubscriptions).values({
      integrationId: DRIVE_INTEGRATION_ID,
      providerConnectionId: DRIVE_CONNECTION_ID,
      provider: 'google_drive',
      externalSubscriptionId: 'drive-channel-1',
      resourceKind: 'google_drive.channel',
      externalResourceId: DRIVE_INTEGRATION_ID,
      eventType: 'change',
      expiresAt: new Date('2026-06-27T00:00:00.000Z'),
      status: 'active',
    });

    await expect(
      adminReconcileExpiringWebhookSubscriptions(db as never, {
        now: new Date('2026-06-28T00:00:00.000Z'),
        renewWithinMs: 0,
      }),
    ).resolves.toEqual({
      checked: 1,
      renewed: 0,
      degraded: 1,
      skipped: 0,
    });

    const [subscription] = await db
      .select()
      .from(integrationWebhookSubscriptions)
      .where(eq(integrationWebhookSubscriptions.integrationId, DRIVE_INTEGRATION_ID));
    expect(subscription).toMatchObject({
      status: 'failed',
      lastError: 'webhook_subscription_expired',
    });
    const [attention] = await db
      .select()
      .from(connectionAttention)
      .where(eq(connectionAttention.integrationId, DRIVE_INTEGRATION_ID));
    expect(attention).toMatchObject({
      category: 'webhook_degraded',
      providerConnectionId: DRIVE_CONNECTION_ID,
    });
    expect(attention?.summary).toContain('expired');
    expect(attention?.summary).toContain('Reconciliation remains active');
  });
});
