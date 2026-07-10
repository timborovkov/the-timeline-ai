import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import type * as jobRecovery from '@timeline/shared/job-recovery';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { bulkRecoveryAuditRecord } from '@/lib/job-recovery-audit';
import { publicApiError } from '@/lib/public-error';

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
  items: z
    .array(
      z.object({
        id: z.string(),
        detectedAt: z.iso.datetime(),
      }),
    )
    .min(1)
    .max(200),
  expectedCount: z.number().int().positive().max(200),
});

interface BulkInput {
  kind?: jobRecovery.JobRecoveryKind;
  items: { id: string; detectedAt: Date }[];
  expectedCount: number;
}

type TeamScope = ReturnType<typeof withTeam>;

export function createBulkFailedJobRecoveryRoute(options: {
  action: 'job.retry' | 'job.dismiss';
  fallbackError: string;
  run: (scope: TeamScope, input: BulkInput) => Promise<object>;
}) {
  return async function POST(req: Request): Promise<Response> {
    const session = await auth();
    if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const { active } = await resolveActiveTeam(session.user.id);
    if (!active) return NextResponse.json({ error: 'no_team' }, { status: 400 });

    const scope = withTeam(db, active.teamId, session.user.id);
    try {
      await scope.requireMembership('admin');
    } catch {
      await scope.audit.record(
        bulkRecoveryAuditRecord({
          action: options.action,
          ids: [],
          outcome: 'rejected',
          reason: 'forbidden',
        }),
      );
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      await scope.audit.record(
        bulkRecoveryAuditRecord({
          action: options.action,
          ids: [],
          outcome: 'rejected',
          reason: 'invalid_input',
        }),
      );
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }

    const auditInput = {
      action: options.action,
      ids: parsed.data.items.map((item) => item.id),
      ...(parsed.data.kind ? { kind: parsed.data.kind } : {}),
    } as const;

    try {
      const result = await options.run(scope, {
        kind: parsed.data.kind,
        items: parsed.data.items.map((item) => ({
          id: item.id,
          detectedAt: new Date(item.detectedAt),
        })),
        expectedCount: parsed.data.expectedCount,
      });
      await scope.audit.record(bulkRecoveryAuditRecord({ ...auditInput, outcome: 'succeeded' }));
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      await scope.audit.record(
        bulkRecoveryAuditRecord({
          ...auditInput,
          outcome: 'rejected',
          reason: 'operation_failed',
        }),
      );
      const failure = publicApiError(err, {
        operation: options.fallbackError,
        fallbackCode: options.fallbackError,
        expected: {
          invalid_recovery_ids: { message: 'invalid_recovery_ids', status: 409 },
          stale_recovery_set: { message: 'stale_recovery_set', status: 409 },
        },
      });
      return NextResponse.json(
        { error: failure.error, ...(failure.reference ? { reference: failure.reference } : {}) },
        { status: failure.status },
      );
    }
  };
}
