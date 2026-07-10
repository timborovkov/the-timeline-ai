import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { singleRecoveryAuditRecord } from '@/lib/job-recovery-audit';
import { publicApiError } from '@/lib/public-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  const scope = withTeam(db, active.teamId, session.user.id);
  const { id } = await ctx.params;
  try {
    await scope.requireMembership('admin');
  } catch {
    await scope.audit.record(
      singleRecoveryAuditRecord({
        action: 'job.retry',
        id,
        outcome: 'rejected',
        reason: 'forbidden',
      }),
    );
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  try {
    await scope.jobRecovery.retryRecoverableJob(id);
    await scope.audit.record(
      singleRecoveryAuditRecord({ action: 'job.retry', id, outcome: 'succeeded' }),
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    await scope.audit.record(
      singleRecoveryAuditRecord({
        action: 'job.retry',
        id,
        outcome: 'rejected',
        reason: 'operation_failed',
      }),
    );
    const failure = publicApiError(err, {
      operation: 'retry_recoverable_job',
      fallbackCode: 'retry_failed',
      expected: {
        invalid_recovery_id: { message: 'invalid_recovery_id', status: 404 },
        not_found: { message: 'not_found', status: 404 },
      },
    });
    return NextResponse.json(
      { error: failure.error, ...(failure.reference ? { reference: failure.reference } : {}) },
      { status: failure.status },
    );
  }
}
