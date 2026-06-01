import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import type * as jobRecovery from '@timeline/shared/job-recovery';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const body: unknown = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  try {
    const result = await scope.jobRecovery.dismissFailedRecoverableJobs({
      kind: parsed.data.kind,
      items: parsed.data.items.map((item) => ({
        id: item.id,
        detectedAt: new Date(item.detectedAt),
      })),
      expectedCount: parsed.data.expectedCount,
      reason: 'bulk dismiss failed jobs',
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'dismiss_failed';
    const status =
      message === 'stale_recovery_set' || message === 'invalid_recovery_ids' ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
