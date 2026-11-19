import type { FirstRunPhase, FirstRunState } from '@timeline/shared/onboarding';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { FirstRecordScreen } from '@/components/onboarding/first-record-screen';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { firstRunCaptureHref, firstRunCaptureKey } from '@/lib/first-run-links';
import { loadFirstRunStatus } from '@/lib/first-run-status';

export const metadata: Metadata = {
  title: 'Your first record',
  description: 'A cited summary of what you just brought in.',
};

export const dynamic = 'force-dynamic';

const SETUP_PHASES = new Set<FirstRunPhase>(['welcome', 'choose', 'processing', 'failed']);
const HOME_PHASES = new Set<FirstRunPhase>(['skipped', 'complete']);

function destinationForRecordPhase(phase: FirstRunPhase | undefined): string | null {
  if (!phase || SETUP_PHASES.has(phase)) return '/onboarding';
  if (HOME_PHASES.has(phase)) return '/app';
  return null;
}

function recordDestination(
  firstRun: FirstRunState | null,
  capture: string | string[] | undefined,
  userId: string,
): string | null {
  if (capture === undefined) return destinationForRecordPhase(firstRun?.phase);
  if (typeof capture !== 'string' || capture.length > 100) return '/onboarding';

  const matchesCapture = capture === firstRunCaptureKey(firstRun);
  if (matchesCapture && firstRun?.startedByUserId === userId && firstRun.firstCaptureLandedAt) {
    return null;
  }
  return firstRunCaptureHref(capture);
}

export default async function FirstRecordPage({
  searchParams,
}: {
  searchParams: Promise<{ capture?: string | string[] }>;
}) {
  const [session, { capture }] = await Promise.all([auth(), searchParams]);
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const status = await loadFirstRunStatus({
    db,
    teamId: active.teamId,
    userId: session.user.id,
    teamSlug: active.teamSlug,
    teamName: active.teamName,
  });
  const firstRun = status.firstRun;
  const destination = recordDestination(firstRun, capture, session.user.id);
  if (destination) redirect(destination);
  const record = status.record;
  const captureStatus =
    capture && firstRun
      ? { startedAt: firstRun.starterSelectedAt, steps: record?.processingSteps ?? [] }
      : null;

  return (
    <FirstRecordScreen
      captureStatus={captureStatus}
      readOnly={Boolean(capture) && firstRun?.phase !== 'record'}
      title={record?.title ?? 'Your first record'}
      meta={record?.meta ?? ''}
      summary={record?.summary ?? null}
      note={
        record?.note ??
        'The record starts updating itself once a channel or your email is connected.'
      }
      sources={record?.sources ?? []}
      suggestions={record?.suggestions ?? []}
    />
  );
}
