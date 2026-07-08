'use server';

import { eventSource } from '@timeline/db';
import { enqueueReconciliationJob } from '@timeline/shared/queue';
import { withTeam } from '@timeline/shared/team-scope';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { runSentryServerAction } from '@/lib/sentry-action';
import { reportCaughtError } from '@/lib/sentry-report';

export interface QueueReconciliationState {
  error?: string;
  ok?: boolean;
  message?: string;
}

const sourceSchema = z
  .enum(eventSource.enumValues)
  .optional()
  .or(z.literal('').transform(() => undefined));

const optionalDateTimeSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  },
  z
    .custom<string>(
      (value) => typeof value === 'string' && !Number.isNaN(new Date(value).getTime()),
    )
    .optional(),
);

const queueReconciliationSchema = z
  .object({
    mode: z.enum(['audit', 'backfill', 'scope']),
    source: sourceSchema,
    dryRun: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value !== 'false'),
    scope: z.enum(['team', 'object', 'cluster']).optional(),
    targetId: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.uuid().optional(),
    ),
    plannerReplayLimit: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : Number(value)),
      z.number().int().min(0).max(1000).optional(),
    ),
    plannerReplayMode: z.enum(['missing', 'all']).optional(),
    plannerReplaySource: sourceSchema,
    plannerReplayOccurredAfter: optionalDateTimeSchema,
    plannerReplayOccurredBefore: optionalDateTimeSchema,
  })
  .superRefine((value, ctx) => {
    if (
      value.plannerReplayOccurredAfter &&
      value.plannerReplayOccurredBefore &&
      new Date(value.plannerReplayOccurredAfter) > new Date(value.plannerReplayOccurredBefore)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['plannerReplayOccurredBefore'],
        message: 'Planner replay end must be after the start',
      });
    }
  });

export async function queueReconciliationJobAction(
  _prev: QueueReconciliationState,
  formData: FormData,
): Promise<QueueReconciliationState> {
  return runSentryServerAction('queue_reconciliation_job', async () => {
    const session = await auth();
    if (!session?.user) return { error: 'Not signed in' };
    const { active } = await resolveActiveTeam(session.user.id);
    if (!active) return { error: 'No active team' };

    const parsed = queueReconciliationSchema.safeParse({
      mode: formData.get('mode'),
      source: formData.get('source') ?? '',
      dryRun: formData.get('dryRun') ?? 'true',
      scope: formData.get('scope') ?? undefined,
      targetId: formData.get('targetId') ?? '',
      plannerReplayLimit: formData.get('plannerReplayLimit') ?? '',
      plannerReplayMode: formData.get('plannerReplayMode') ?? undefined,
      plannerReplaySource: formData.get('plannerReplaySource') ?? '',
      plannerReplayOccurredAfter: formData.get('plannerReplayOccurredAfter') ?? '',
      plannerReplayOccurredBefore: formData.get('plannerReplayOccurredBefore') ?? '',
    });
    if (!parsed.success) return { error: 'Invalid reconciliation job request' };
    const reconcileScopeKind = parsed.data.mode === 'scope' ? (parsed.data.scope ?? 'team') : null;
    if (reconcileScopeKind && reconcileScopeKind !== 'team' && !parsed.data.targetId) {
      return { error: 'Object and cluster reconciliation require a target id' };
    }

    const scope = withTeam(db, active.teamId, session.user.id);
    if (parsed.data.mode === 'scope') {
      try {
        await scope.requireMembership('admin');
        await enqueueReconciliationJob({
          kind: 'scope_reconcile',
          teamId: active.teamId,
          scope: reconcileScopeKind ?? 'team',
          ...(parsed.data.targetId === undefined ? {} : { targetId: parsed.data.targetId }),
          triggeredBy: session.user.id,
          reason: 'admin_dashboard',
          ...(parsed.data.plannerReplayLimit === undefined
            ? {}
            : { plannerReplayLimit: parsed.data.plannerReplayLimit }),
          ...(parsed.data.plannerReplayMode === undefined
            ? {}
            : { plannerReplayMode: parsed.data.plannerReplayMode }),
          ...(parsed.data.plannerReplaySource === undefined
            ? {}
            : { plannerReplaySource: parsed.data.plannerReplaySource }),
          ...(parsed.data.plannerReplayOccurredAfter === undefined
            ? {}
            : { plannerReplayOccurredAfter: parsed.data.plannerReplayOccurredAfter }),
          ...(parsed.data.plannerReplayOccurredBefore === undefined
            ? {}
            : { plannerReplayOccurredBefore: parsed.data.plannerReplayOccurredBefore }),
        });
        revalidatePath('/app/team/reconciliation');
        return {
          ok: true,
          message:
            reconcileScopeKind === 'team'
              ? 'Queued manual reconciliation for the team.'
              : `Queued manual reconciliation for ${reconcileScopeKind} ${parsed.data.targetId}.`,
        };
      } catch (err) {
        reportCaughtError(err, { surface: 'server_action', operation: 'queue_reconciliation_job' });
        return { error: 'Could not queue reconciliation work' };
      }
    }

    try {
      await scope.requireMembership('admin');
      const common = {
        teamId: active.teamId,
        limit: 5_000,
        pageSize: 500,
        triggeredBy: session.user.id,
        ...(parsed.data.source === undefined ? {} : { source: parsed.data.source }),
      };
      if (parsed.data.mode === 'audit') {
        await enqueueReconciliationJob({ kind: 'evidence_audit', ...common });
      } else {
        await enqueueReconciliationJob({
          kind: 'evidence_backfill',
          ...common,
          dryRun: parsed.data.dryRun,
          missingOnly: true,
        });
      }
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'queue_reconciliation_job' });
      return { error: 'Could not queue reconciliation work' };
    }

    revalidatePath('/app/team/reconciliation');
    const sourceLabel = parsed.data.source ?? 'all sources';
    const action = parsed.data.mode === 'audit' ? 'audit' : 'missing-only backfill';
    return { ok: true, message: `Queued ${action} for ${sourceLabel}.` };
  });
}

export async function queueReconciliationJobFormAction(formData: FormData): Promise<void> {
  const state = await queueReconciliationJobAction({}, formData);
  const params = new URLSearchParams();
  if (state.ok) {
    params.set('reconciliationNotice', 'queued');
    params.set('message', state.message ?? 'Queued reconciliation work.');
  } else {
    params.set('reconciliationNotice', 'error');
    params.set('message', state.error ?? 'Could not queue reconciliation work.');
  }
  redirect(`/app/team/reconciliation?${params.toString()}`);
}
