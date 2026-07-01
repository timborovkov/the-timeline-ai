import * as integrationsLib from '@timeline/shared/integrations';
import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TeamScope = ReturnType<typeof withTeam>;
type RedisQueue = Awaited<ReturnType<typeof requireRedisQueue>>;

function pausedResponse(input: { retryAt: Date; reason: string; scope?: string }): Response {
  return NextResponse.json(
    {
      error: 'provider_budget_paused',
      message: `Provider quota is cooling down until ${input.retryAt.toISOString()}.`,
      reason: input.reason,
      retryAt: input.retryAt.toISOString(),
      ...(input.scope ? { scope: input.scope } : {}),
    },
    { status: 429 },
  );
}

async function enqueueBackfillAndRecordAudit(input: {
  redisQueue: RedisQueue;
  scope: TeamScope;
  integration: { id: string };
  teamId: string;
  userId: string;
}): Promise<void> {
  await input.redisQueue.enqueueIntegrationSyncJob({
    kind: 'backfill',
    integrationId: input.integration.id,
    teamId: input.teamId,
    triggeredBy: input.userId,
  });
  await input.scope.integrations.recordAudit(
    'backfill_requested',
    { actor: input.userId },
    input.integration.id,
  );
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  void req;
  const [session, { id }] = await Promise.all([auth(), ctx.params]);
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const integration = await scope.integrations.getIntegration(id);
  if (!integration) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const integrationPause = await integrationsLib.adminLoadIntegrationSyncPause(db, integration.id);
  if (integrationPause) {
    await scope.integrations.recordAudit(
      'backfill_skipped:provider_budget',
      {
        actor: session.user.id,
        provider: integration.provider,
        reason: integrationPause.reason,
        retryAt: integrationPause.retryAt.toISOString(),
      },
      integration.id,
    );
    return pausedResponse(integrationPause);
  }
  const budgetKey = integrationsLib.providerBudgetKeyForIntegration(integration);
  const providerPause = budgetKey
    ? await integrationsLib.adminLoadProviderBudgetPause(db, budgetKey)
    : null;
  if (providerPause) {
    await scope.integrations.recordAudit(
      'backfill_skipped:provider_budget',
      {
        actor: session.user.id,
        provider: integration.provider,
        reason: providerPause.reason,
        scope: providerPause.scope,
        retryAt: providerPause.retryAt.toISOString(),
      },
      integration.id,
    );
    return pausedResponse(providerPause);
  }
  const redisQueue = await requireRedisQueue();
  await enqueueBackfillAndRecordAudit({
    redisQueue,
    scope,
    integration,
    teamId: active.teamId,
    userId: session.user.id,
  });
  return NextResponse.json({ ok: true });
}
