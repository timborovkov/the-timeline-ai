import { childLogger } from '@timeline/shared/logger';
import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:integrations:resume');

function healthCause(error: string | null): string {
  return (error ?? 'none').replace(/\s+/g, ' ').slice(0, 200);
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
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
  const result = await scope.integrations.resumeIntegrationHealth(id);
  if (!result.resumed && !result.backfillPending) {
    return NextResponse.json({ ok: true, resumed: false });
  }
  const cause = healthCause(result.previousError);
  log.info(
    {
      integrationId: integration.id,
      teamId: active.teamId,
      provider: integration.provider,
      providerConnectionId: integration.providerConnectionId,
      previousKind: result.previousKind,
      actor: session.user.id,
    },
    `integration health resumed previousKind=${result.previousKind ?? 'unknown'} integrationId=${integration.id} provider=${integration.provider} providerConnectionId=${integration.providerConnectionId ?? 'none'} cause=${cause} actor=${session.user.id}`,
  );
  // react-doctor-disable-next-line react-doctor/async-parallel -- Redis enqueue depends on the queue client; backfill audit and pending-clear only after enqueue commits.
  const redisQueue = await requireRedisQueue();
  await redisQueue.enqueueIntegrationSyncJob({
    kind: 'backfill',
    integrationId: integration.id,
    teamId: active.teamId,
    triggeredBy: session.user.id,
  });
  await scope.integrations.recordAudit(
    'backfill_requested',
    { actor: session.user.id, reason: 'health_resume' },
    integration.id,
  );
  await scope.integrations.completeHealthResumeBackfill(id);
  return NextResponse.json({ ok: true, resumed: true });
}
