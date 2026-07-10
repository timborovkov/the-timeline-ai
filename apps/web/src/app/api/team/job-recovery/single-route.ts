import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { recordRecoveryAuditBestEffort, singleRecoveryAuditRecord } from '@/lib/job-recovery-audit';
import { publicApiErrorResponse } from '@/lib/public-error';

type TeamScope = ReturnType<typeof withTeam>;

export function createSingleFailedJobRecoveryRoute(options: {
  action: 'job.retry' | 'job.dismiss';
  operation: string;
  fallbackCode: string;
  run: (scope: TeamScope, id: string) => Promise<unknown>;
}) {
  return async function POST(
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
      await recordRecoveryAuditBestEffort(
        () =>
          scope.audit.record(
            singleRecoveryAuditRecord({
              action: options.action,
              id,
              outcome: 'rejected',
              reason: 'forbidden',
            }),
          ),
        options.operation,
      );
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    try {
      await options.run(scope, id);
      await recordRecoveryAuditBestEffort(
        () =>
          scope.audit.record(
            singleRecoveryAuditRecord({ action: options.action, id, outcome: 'succeeded' }),
          ),
        options.operation,
      );
      return NextResponse.json({ ok: true });
    } catch (err) {
      await recordRecoveryAuditBestEffort(
        () =>
          scope.audit.record(
            singleRecoveryAuditRecord({
              action: options.action,
              id,
              outcome: 'rejected',
              reason: 'operation_failed',
            }),
          ),
        options.operation,
      );
      return publicApiErrorResponse(err, {
        operation: options.operation,
        fallbackCode: options.fallbackCode,
        expected: {
          invalid_recovery_id: { message: 'invalid_recovery_id', status: 404 },
          not_found: { message: 'not_found', status: 404 },
        },
      });
    }
  };
}
