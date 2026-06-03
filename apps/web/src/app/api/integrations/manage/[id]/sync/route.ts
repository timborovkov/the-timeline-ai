import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const [integration, queue] = await Promise.all([
    scope.integrations.getIntegration(id),
    requireRedisQueue(),
  ]);
  if (!integration) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await queue.enqueueIntegrationSyncJob({
    kind: 'backfill',
    integrationId: integration.id,
    teamId: active.teamId,
    triggeredBy: session.user.id,
  });
  await scope.integrations.recordAudit(
    'backfill_requested',
    { actor: session.user.id },
    integration.id,
  );
  return NextResponse.json({ ok: true });
}
