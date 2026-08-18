import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import type * as jobRecovery from '@timeline/shared/job-recovery';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { bulkRecoveryAuditRecord, recordRecoveryAuditBestEffort } from '@/lib/job-recovery-audit';
import { publicApiErrorResponse } from '@/lib/public-error';

const JOB_KINDS = [
  'transcription',
  'extraction',
  'embedding',
  'document_processing',
  'meeting_finalization',
  'integration_sync',
] as const satisfies readonly jobRecovery.JobRecoveryKind[];

const schema = z.object({
  kind: z.enum(JOB_KINDS).optional(),
  window: z.enum(['recent', 'older']),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return NextResponse.json({ error: 'no_team' }, { status: 400 });

  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    await recordRecoveryAuditBestEffort(
      () =>
        scope.audit.record(
          bulkRecoveryAuditRecord({
            action: 'job.dismiss',
            ids: [],
            outcome: 'rejected',
            reason: 'forbidden',
          }),
        ),
      'dismiss_matching',
    );
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body: unknown = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    await recordRecoveryAuditBestEffort(
      () =>
        scope.audit.record(
          bulkRecoveryAuditRecord({
            action: 'job.dismiss',
            ids: [],
            outcome: 'rejected',
            reason: 'invalid_input',
          }),
        ),
      'dismiss_matching',
    );
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const auditInput = {
    action: 'job.dismiss' as const,
    ids: [] as string[],
    ...(parsed.data.kind ? { kind: parsed.data.kind } : {}),
    reason: parsed.data.window === 'older' ? 'dismiss older jobs' : 'dismiss recent jobs',
  };

  try {
    const result = await scope.jobRecovery.dismissMatchingRecoverableJobs({
      window: parsed.data.window,
      ...(parsed.data.kind ? { kind: parsed.data.kind } : {}),
      reason: auditInput.reason,
    });
    await recordRecoveryAuditBestEffort(
      () =>
        scope.audit.record(
          bulkRecoveryAuditRecord({
            ...auditInput,
            outcome: 'succeeded',
          }),
        ),
      'dismiss_matching',
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    await recordRecoveryAuditBestEffort(
      () =>
        scope.audit.record(
          bulkRecoveryAuditRecord({
            ...auditInput,
            outcome: 'rejected',
            reason: 'operation_failed',
          }),
        ),
      'dismiss_matching',
    );
    return publicApiErrorResponse(err, {
      operation: 'dismiss_matching',
      fallbackCode: 'dismiss_matching',
    });
  }
}
