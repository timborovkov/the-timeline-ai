import { type Db, integrations, integrationSelections } from '@timeline/db';
import { and, eq } from 'drizzle-orm';

import { adminDecryptIntegrationTokens, adminSaveCursor } from '#src/integrations/scope.js';
import { recordWebhookDeliveryTargets } from '#src/integrations/webhooks.js';

/** Pre-principal routing: call only after verifying the Slack signature. */
export async function acceptSignedSlackNativeEvent(
  db: Db,
  payload: unknown,
): Promise<string | null> {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  if (
    root.type !== 'event_callback' ||
    typeof root.team_id !== 'string' ||
    typeof root.api_app_id !== 'string' ||
    typeof root.event_id !== 'string'
  )
    return null;
  if (!root.event || typeof root.event !== 'object') return null;
  const event = root.event as Record<string, unknown>;
  const item =
    event.item && typeof event.item === 'object' ? (event.item as Record<string, unknown>) : {};
  const channel =
    typeof event.channel === 'string'
      ? event.channel
      : typeof event.channel_id === 'string'
        ? event.channel_id
        : item.channel;
  if (typeof channel !== 'string') return null;
  const rows = await db
    .select({ integration: integrations })
    .from(integrations)
    .innerJoin(
      integrationSelections,
      and(
        eq(integrationSelections.integrationId, integrations.id),
        eq(integrationSelections.selectionKind, 'slack.channel'),
        eq(integrationSelections.externalId, channel),
      ),
    )
    .where(
      and(
        eq(integrations.provider, 'slack'),
        eq(integrations.enabled, true),
        eq(integrations.externalAccountId, root.team_id),
      ),
    );
  const targets = [];
  for (const { integration } of rows) {
    const tokens = await adminDecryptIntegrationTokens(db, integration);
    const scopes = new Set(typeof tokens?.scope === 'string' ? tokens.scope.split(',') : []);
    const user = tokens?.authed_user as { access_token?: string; scope?: string } | undefined;
    const userScopes = new Set(user?.scope?.split(',') ?? []);
    if (
      tokens?.app_id !== root.api_app_id ||
      !user?.access_token ||
      !['channels:history', 'groups:history'].every((scope) => userScopes.has(scope)) ||
      !['channels:history', 'groups:history', 'reactions:read', 'files:read'].every((scope) =>
        scopes.has(scope),
      )
    )
      continue;
    await adminSaveCursor(db, integration.id, 'slack.webhook', {
      app_id: root.api_app_id,
      verified_at: new Date().toISOString(),
    });
    targets.push({
      teamId: integration.teamId,
      integrationId: integration.id,
      providerConnectionId: integration.providerConnectionId,
    });
  }
  if (!targets.length) return null;
  const recorded = await recordWebhookDeliveryTargets(db, {
    provider: 'slack',
    externalDeliveryId: root.event_id,
    externalAccountId: root.team_id,
    resourceKind: 'slack.channel',
    externalResourceId: channel,
    eventType: typeof event.type === 'string' ? event.type : 'unknown',
    payload,
    dedupKey: `slack:delivery:${root.event_id}`,
    targets,
  });
  return recorded.deliveryId;
}
