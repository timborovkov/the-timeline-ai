import {
  firstCaptureJustLanded,
  prefilledAskQuestion,
  recommendedGoLiveChannel,
  type FirstRunState,
} from '@timeline/shared/onboarding';
import { withTeam } from '@timeline/shared/team-scope';

import type { Db } from '@timeline/db';

import { trackProductEventBestEffort } from '@/lib/analytics';
import { displayInboundEmail } from '@/lib/hub-status';

export async function loadFirstRunStatus(input: {
  db: Db;
  teamId: string;
  userId: string;
  teamSlug: string;
  teamName: string;
}) {
  const scope = withTeam(input.db, input.teamId, input.userId);
  const before = await scope.onboarding.getFirstRun();
  if (before?.starterPath === 'document') {
    await scope.onboarding.refreshDocumentCapture();
  }
  if (before?.starterPath === 'email') {
    await scope.onboarding.detectEmailArrival();
  }
  const record = await scope.onboarding.getFirstRunRecord();
  const firstRun = record?.firstRun ?? (await scope.onboarding.getFirstRun());
  const landedPath = firstCaptureJustLanded(before, firstRun);
  if (landedPath) {
    trackProductEventBestEffort(
      { kind: 'user', userId: input.userId, teamId: input.teamId },
      'first_capture_landed',
      { path: landedPath },
    );
  }
  return {
    firstRun,
    inboundEmail: displayInboundEmail({
      slug: input.teamSlug,
      inboundEmail: record?.inboundEmail ?? null,
    }),
    teamName: record?.teamName ?? input.teamName,
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
  };
}

export function firstRunGuideProps(firstRun: FirstRunState | null): {
  phase: FirstRunState['phase'];
  hidden: boolean;
} | null {
  if (!firstRun) return null;
  return { phase: firstRun.phase, hidden: Boolean(firstRun.guideHiddenAt) };
}
