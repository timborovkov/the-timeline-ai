import * as integrationsLib from '@timeline/shared/integrations';
import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { safeMarkOnboardingStep } from '@/lib/onboarding';
import { requireRedisQueue } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const activateSchema = z.object({
  providerConnectionId: z.uuid(),
  resourceShareIds: z.array(z.uuid()),
});

async function markFirstIntegrationAfterActivation(
  scope: ReturnType<typeof withTeam>,
  integrationId: string,
) {
  if (!integrationId) return false;
  return safeMarkOnboardingStep(scope, 'first_integration');
}

async function reconcileWebhooksBestEffort(
  scope: ReturnType<typeof withTeam>,
  integration: {
    id: string;
    provider: integrationsLib.IntegrationProviderName;
    providerConnectionId?: string | null;
    scopes?: string[] | null;
  },
) {
  if (integration.provider === 'mcp') return;
  const missingScopes = integrationsLib.missingRequiredProviderScopes(
    integration.provider,
    integration.scopes,
  );
  if (missingScopes.length > 0) {
    await scope.integrations.recordAudit(
      'webhook_provision_skipped_missing_scopes',
      { provider: integration.provider, missingScopes },
      integration.id,
    );
    await scope.integrations.recordConnectionAttention({
      providerConnectionId: integration.providerConnectionId ?? null,
      integrationId: integration.id,
      category: 'needs_reconnect',
      summary: `${integration.provider} connection is missing required OAuth scopes (${missingScopes.join(
        ', ',
      )}); reconnect to enable webhook provisioning and account-scoped provider budgets.`,
    });
    return;
  }
  try {
    const result = await integrationsLib.adminReconcileIntegrationWebhookSubscriptions(
      db,
      integration.id,
    );
    if (!result.skipped) {
      await Promise.all([
        scope.integrations.recordAudit(
          'webhooks_reconciled',
          {
            provider: integration.provider,
            active: result.active,
            deprovisioned: result.deprovisioned,
          },
          integration.id,
        ),
        scope.integrations.resolveConnectionAttention({
          providerConnectionId: integration.providerConnectionId ?? null,
          integrationId: integration.id,
          categories: ['webhook_degraded'],
        }),
      ]);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await scope.integrations.recordAudit(
      'webhook_provision_failed',
      { provider: integration.provider, error: message.slice(0, 500) },
      integration.id,
    );
    await scope.integrations.recordConnectionAttention({
      providerConnectionId: integration.providerConnectionId ?? null,
      integrationId: integration.id,
      category: 'webhook_degraded',
      summary: `Webhook provisioning failed for ${integration.provider}: ${message.slice(0, 300)}`,
    });
  }
}

async function enqueueInitialBackfillBestEffort(
  scope: ReturnType<typeof withTeam>,
  integration: {
    id: string;
    provider: integrationsLib.IntegrationProviderName;
    providerConnectionId?: string | null;
  },
  teamId: string,
  userId: string,
): Promise<boolean> {
  if (integration.provider === 'mcp') return false;
  try {
    await requireRedisQueue()
      .then((redisQueue) =>
        redisQueue.enqueueIntegrationSyncJob({
          kind: 'backfill',
          integrationId: integration.id,
          teamId,
          triggeredBy: userId,
        }),
      )
      .then(() =>
        scope.integrations.recordAudit(
          'backfill_requested',
          { actor: userId, source: 'activation' },
          integration.id,
        ),
      );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await Promise.all([
      scope.integrations.recordAudit(
        'backfill_enqueue_failed',
        { provider: integration.provider, error: message.slice(0, 500) },
        integration.id,
      ),
      scope.integrations.recordConnectionAttention({
        providerConnectionId: integration.providerConnectionId ?? null,
        integrationId: integration.id,
        category: 'sync_error',
        summary: `Initial ${integration.provider} sync could not be queued: ${message.slice(0, 300)}`,
      }),
    ]);
    return false;
  }
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const parsed = activateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad_request', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const integration = await scope.integrations.activateSharedResources(parsed.data);
  const syncRequired = integration.addedSelectionCount > 0;
  const [syncQueued, , completedFirstIntegration] = await Promise.all([
    syncRequired
      ? enqueueInitialBackfillBestEffort(scope, integration, active.teamId, session.user.id)
      : Promise.resolve(false),
    reconcileWebhooksBestEffort(scope, integration),
    markFirstIntegrationAfterActivation(scope, integration.id),
  ]);
  trackProductEventBestEffort(session.user.id, 'integration_connected', {
    teamId: active.teamId,
    userId: session.user.id,
    integrationId: integration.id,
    provider: integration.provider,
  });
  if (completedFirstIntegration) {
    trackProductEventBestEffort(session.user.id, 'onboarding_step_completed', {
      teamId: active.teamId,
      userId: session.user.id,
      step: 'first_integration',
      source: 'automatic',
    });
  }
  return NextResponse.json({
    ok: true,
    integrationId: integration.id,
    syncRequired,
    syncQueued,
  });
}
