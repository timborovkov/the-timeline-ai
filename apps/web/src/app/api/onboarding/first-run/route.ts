import { getEnv } from '@timeline/shared/env';
import {
  isWebsiteScanEnabled,
  prefilledAskQuestion,
  recommendedGoLiveChannel,
} from '@timeline/shared/onboarding';
import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { displayInboundEmail } from '@/lib/hub-status';
import { reportCaughtError } from '@/lib/sentry-report';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) {
    return NextResponse.json({ error: 'No active team' }, { status: 403 });
  }

  try {
    const scope = withTeam(db, active.teamId, session.user.id);
    const before = await scope.onboarding.getFirstRun();
    if (before?.starterPath === 'document') {
      await scope.onboarding.refreshDocumentCapture();
    }
    if (before?.starterPath === 'email') {
      await scope.onboarding.detectEmailArrival();
    }
    const record = await scope.onboarding.getFirstRunRecord();
    const firstRun = record?.firstRun ?? (await scope.onboarding.getFirstRun());
    if (
      firstRun?.firstCaptureLandedAt &&
      before &&
      !before.firstCaptureLandedAt &&
      (firstRun.starterPath === 'document' ||
        firstRun.starterPath === 'email' ||
        firstRun.starterPath === 'website')
    ) {
      trackProductEventBestEffort(
        { kind: 'user', userId: session.user.id, teamId: active.teamId },
        'first_capture_landed',
        { path: firstRun.starterPath },
      );
    }

    return NextResponse.json({
      firstRun,
      websiteScanEnabled: isWebsiteScanEnabled(getEnv()),
      inboundEmail: displayInboundEmail({
        slug: active.teamSlug,
        inboundEmail: record?.inboundEmail ?? null,
      }),
      teamName: record?.teamName ?? active.teamName,
      recommendedChannel: recommendedGoLiveChannel(firstRun?.workStyle ?? null),
      prefilledQuestion: prefilledAskQuestion({
        path: firstRun?.starterPath ?? null,
        workStyle: firstRun?.workStyle ?? null,
        recordTitle: record?.recordTitle,
      }),
      record: record
        ? {
            title: record.recordTitle,
            meta: record.recordMeta,
            summary: record.summary,
            note: record.note,
            sources: record.sources,
            suggestions: record.suggestions,
            processingSteps: record.processingSteps,
            emailArrived: record.emailArrived,
          }
        : null,
    });
  } catch (err) {
    reportCaughtError(err, { surface: 'api', operation: 'onboarding_first_run_status' });
    return NextResponse.json({ error: 'Unable to load onboarding status' }, { status: 500 });
  }
}
