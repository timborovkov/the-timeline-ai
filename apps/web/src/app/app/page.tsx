import { teams, users } from '@timeline/db';
import { latestDailyDigest, type DailyDigestPayload } from '@timeline/shared/messaging';
import { GUIDED_SHELL_PHASES, type FirstRunState } from '@timeline/shared/onboarding/first-run';
import { getAudioBucket, getS3PresignClient, getSignedGetObjectUrl } from '@timeline/shared/s3';
import { withTeam } from '@timeline/shared/team-scope';
import { eq, inArray } from 'drizzle-orm';
import { Boxes, CircleAlert, CircleCheckBig, ListTodo } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { BillingRestrictionNotice } from '@/components/billing-restriction-notice';
import { BillingUpgradeNudge } from '@/components/billing-upgrade-nudge';
import { CaptureForm } from '@/components/capture-form';
import { ConnectAgentOnboardingCard } from '@/components/connect-agent/connect-agent-onboarding';
import { CaptureDialog } from '@/components/home/capture-dialog';
import { DailyDigestBlock } from '@/components/home/daily-digest-block';
import { HomeAskComposer } from '@/components/home/home-ask-composer';
import { HomeAttention } from '@/components/home/home-attention';
import { HomeProcessingAttention } from '@/components/home/home-processing-attention';
import { HomeTeamEmail } from '@/components/home/home-team-email';
import { FirstRunHomeCapture } from '@/components/onboarding/first-run-home-capture';
import { OnboardingChecklist } from '@/components/onboarding-checklist';
import { PaygValueNudge } from '@/components/payg-value-nudge';
import { PinnedWorkspacePreview } from '@/components/pins/pinned-workspace-preview';
import { TimelineFeed } from '@/components/timeline-feed';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { displayMemberLabel } from '@/lib/display-labels';
import { loadFirstRunStatus } from '@/lib/first-run-status';
import {
  displayInboundEmail,
  getHomeOpenObjectCounts,
  getWorkAttentionSummary,
  homeOpenObjectTotal,
  homeWorkNeedingAttentionCount,
} from '@/lib/hub-status';
import { loadOnboardingChecklistView } from '@/lib/onboarding-checklist';
import { reportCaughtError } from '@/lib/sentry-report';
import { listTimelineCapturedFilesByEventId } from '@/lib/timeline-captured-files';
import { buildTimelineMoments } from '@/lib/timeline-moments';

export const metadata: Metadata = {
  title: 'Home',
  description: 'Ask what changed and review work that needs attention.',
};

const HOME_TIMELINE_EVENT_LIMIT = 16;
const HOME_TIMELINE_MOMENT_LIMIT = 4;

async function signAudio(events: { id: string; contentAudioUrl: string | null }[]) {
  const audioEvents = events.filter((event) => event.contentAudioUrl);
  const audioUrls = new Map<string, string>();
  if (audioEvents.length === 0) return audioUrls;
  try {
    const s3 = getS3PresignClient();
    const bucket = getAudioBucket();
    const pairs = await Promise.all(
      audioEvents.map(async (event) => {
        try {
          const url = await getSignedGetObjectUrl(s3, bucket, event.contentAudioUrl ?? '', 3600);
          return [event.id, url] as const;
        } catch {
          return [event.id, ''] as const;
        }
      }),
    );
    for (const [id, url] of pairs) if (url) audioUrls.set(id, url);
  } catch (error) {
    console.error('[home] audio playback unavailable; S3 is not configured', error);
  }
  return audioUrls;
}

async function shouldShowPaygSuggestion(input: {
  isAdmin: boolean;
  dashboard: {
    account?: { planId: string };
    restrictionReason?: string | null;
    nudge?: unknown;
  } | null;
  hasAnswer: () => Promise<boolean>;
}): Promise<boolean> {
  if (
    !input.isAdmin ||
    input.dashboard?.account?.planId !== 'free' ||
    input.dashboard.restrictionReason ||
    input.dashboard.nudge
  )
    return false;
  return input.hasAnswer().catch((err: unknown) => {
    reportCaughtError(err, { surface: 'render', operation: 'payg_suggestion' });
    return false;
  });
}

function homeEmptyTimelineCopy(isEmpty: boolean): { label: string; actionBody: string } {
  if (isEmpty) {
    return {
      label: 'Your timeline starts with a source',
      actionBody: 'Forward an email, upload a document or connect a channel to start it.',
    };
  }
  return {
    label: 'No recent moments yet',
    actionBody:
      'Moments will appear here as the timeline collects work from capture and connected sources.',
  };
}

async function resolveFirstRunHomeCapture(input: {
  firstRun: FirstRunState | null;
  teamId: string;
  userId: string;
  teamSlug: string;
}): Promise<{ failed: boolean } | 'record' | null> {
  if (input.firstRun?.phase === 'failed') return { failed: true };
  if (input.firstRun?.phase !== 'processing') return null;
  const status = await loadFirstRunStatus({
    db,
    teamId: input.teamId,
    userId: input.userId,
    teamSlug: input.teamSlug,
    teamName: 'Your team',
  });
  const nextPhase = status.firstRun?.phase ?? input.firstRun.phase;
  if (GUIDED_SHELL_PHASES.includes(nextPhase)) return 'record';
  const stepsFailed = (status.record?.processingSteps ?? []).some(
    (step) => step.status === 'failed',
  );
  return { failed: nextPhase === 'failed' || stepsFailed };
}

function firstRunStarterPath(row: FirstRunState | null) {
  return row?.starterPath ?? null;
}

function homeTeamSlug(teamRow: { slug: string } | null, teamId: string) {
  return teamRow?.slug ?? teamId;
}

async function FirstRunHomeBanner(input: {
  firstRun: FirstRunState | null;
  teamId: string;
  userId: string;
  teamSlug: string;
}) {
  const result = await resolveFirstRunHomeCapture(input);
  if (result === 'record') redirect('/app/onboarding/record');
  if (!result) return null;
  return (
    <FirstRunHomeCapture
      failed={result.failed}
      emailWaiting={input.firstRun?.starterPath === 'email'}
    />
  );
}

export default async function HomeDashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const [role, calendarSettings] = await Promise.all([
    scope.requireMembership(),
    scope.calendar.getCalendarSettings(),
  ]);
  const isAdmin = role === 'owner' || role === 'admin';
  const now = new Date();
  const firstRunRow = await scope.onboarding.getFirstRun();
  const starterPath = firstRunStarterPath(firstRunRow);

  const [
    workAttention,
    openObjectCounts,
    eventPage,
    members,
    webDefault,
    pinnedPage,
    latestDigest,
    connectionAttention,
    initialChecklist,
    recoverableJobs,
    billingDashboard,
    teamRow,
    sourceDocuments,
  ] = await Promise.all([
    getWorkAttentionSummary(scope, now, calendarSettings.defaultTimezone),
    getHomeOpenObjectCounts(scope),
    scope.timeline.listEventsPage({ limit: HOME_TIMELINE_EVENT_LIMIT, to: now }),
    scope.timeline.listMembers(),
    scope.timeline.resolveVisibilityDefault('web'),
    scope.pins.list({ limit: 6 }),
    latestDailyDigest({ db, teamId: active.teamId, userId: session.user.id }),
    scope.integrations.listConnectionAttention(),
    loadOnboardingChecklistView({
      teamId: active.teamId,
      userId: session.user.id,
      getChecklistState: () => scope.onboarding.getChecklistState(),
      starterPath,
    }).catch((err: unknown) => {
      reportCaughtError(err, { surface: 'render', operation: 'onboarding_checklist' });
      return null;
    }),
    isAdmin ? scope.jobRecovery.listRecoverableJobs() : Promise.resolve([]),
    scope.billing.getDashboard({ canManageBilling: isAdmin }).catch((err: unknown) => {
      reportCaughtError(err, { surface: 'render', operation: 'billing_dashboard' });
      return null;
    }),
    db
      .select({ slug: teams.slug, inboundEmail: teams.inboundEmail })
      .from(teams)
      .where(eq(teams.id, active.teamId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    scope.documents.listDocuments({ limit: 1 }),
  ]);
  const showPaygSuggestion = await shouldShowPaygSuggestion({
    isAdmin,
    dashboard: billingDashboard,
    hasAnswer: () => scope.objects.hasCompletedChatAnswer(),
  });
  const inboundEmail = displayInboundEmail(teamRow);
  const firstRunBanner = await FirstRunHomeBanner({
    firstRun: firstRunRow,
    teamId: active.teamId,
    userId: session.user.id,
    teamSlug: homeTeamSlug(teamRow, active.teamId),
  });
  const events = eventPage.items;
  const pendingApprovals = workAttention.pendingApprovals;
  const urgentWorkCount = homeWorkNeedingAttentionCount(workAttention);
  const openObjectTotal = homeOpenObjectTotal(openObjectCounts);

  const [impactItems, artifactClusters, audioUrlMap, capturedFiles] = await Promise.all([
    scope.timeline.listImpactItems(events.map((event) => event.id)),
    scope.timeline.listArtifactClusters(events.map((event) => event.id)),
    signAudio(events),
    listTimelineCapturedFilesByEventId({
      db,
      teamId: active.teamId,
      userId: session.user.id,
      eventIds: events.map((event) => event.id),
    }),
  ]);

  const userIds = Array.from(
    new Set([
      ...events.map((event) => event.authorUserId).filter((id): id is string => id !== null),
      ...members.map((member) => member.userId),
    ]),
  );
  const userRows =
    userIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];
  const userMap = new Map(userRows.map((row) => [row.id, row] as const));
  const homeMoments = buildTimelineMoments(events, userMap, {
    impactItemsByEventId: impactItems,
    artifactClustersByEventId: artifactClusters,
    timezone: calendarSettings.defaultTimezone,
  });
  const homeMomentPinState = await scope.pins.isPinnedMany(
    homeMoments.map((moment) => ({ kind: 'timeline_moment' as const, key: moment.id })),
  );
  const quickCaptureVisibility = webDefault.visibility === 'private' ? 'private' : 'team';
  const emptyTimeline = homeEmptyTimelineCopy(events.length === 0);

  return (
    <div data-app-width="overview" className="home-overview space-y-8">
      <header className="grid items-start gap-6 border-b border-border pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,1fr)]">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">
            {active.teamName}
          </h1>
          <p className="mt-2 text-sm text-fg-muted">
            Review what needs attention and catch up on recent work.
          </p>
          <div className="mt-4 flex items-center gap-4">
            <CaptureDialog>
              <CaptureForm
                initialVisibility={quickCaptureVisibility}
                currentUser={{
                  id: session.user.id,
                  name: session.user.name ?? null,
                  email: session.user.email ?? '',
                }}
                filters={{}}
              />
            </CaptureDialog>
          </div>
        </div>
        <HomeAskComposer
          teamId={active.teamId}
          hasSources={events.length > 0 || sourceDocuments.length > 0}
        />
      </header>
      {firstRunBanner}
      {billingDashboard?.restrictionReason ? (
        <BillingRestrictionNotice reason={billingDashboard.restrictionReason} />
      ) : null}

      <OnboardingChecklist initialData={initialChecklist} />

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-8">
          <HomeAttention
            title="Your work"
            groups={[
              {
                href: '/app/approvals',
                label: 'Pending approvals',
                singularLabel: 'Pending approval',
                count: pendingApprovals,
                action: 'Review proposals',
                icon: <CircleCheckBig aria-hidden="true" />,
              },
              {
                href: '/app/work',
                label: 'Work needing attention',
                count: urgentWorkCount,
                action: 'Open work queue',
                icon: <CircleAlert aria-hidden="true" />,
                danger: true,
              },
              {
                href: '/app/tasks',
                label: 'Open tasks',
                singularLabel: 'Open task',
                count: openObjectCounts.task,
                action: 'Open tasks',
                icon: <ListTodo aria-hidden="true" />,
              },
              {
                href: '/app/objects',
                label: 'Open objects',
                singularLabel: 'Open object',
                count: openObjectTotal,
                action: 'People, companies, projects, and more',
                icon: <Boxes aria-hidden="true" />,
              },
            ]}
          />

          <section className="space-y-4 border-t border-border pt-6" aria-label="Recent moments">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Recent activity</h2>
              <Link href="/app/timeline" className="text-sm text-fg-muted hover:text-fg">
                View timeline →
              </Link>
            </div>
            <TimelineFeed
              initialPage={{
                items: events.map((event) => ({
                  ...event,
                  occurredAt: event.occurredAt.toISOString(),
                  createdAt: event.createdAt.toISOString(),
                })),
                nextCursor: null,
                pinnedMomentIds: homeMoments.flatMap((moment) =>
                  homeMomentPinState[`timeline_moment:${moment.id}`] ? [moment.id] : [],
                ),
                authors: Object.fromEntries(userRows.map((row) => [row.id, row])),
                audioUrls: Object.fromEntries(audioUrlMap),
                impactItems,
                artifactClusters,
                capturedFiles,
              }}
              filters={{}}
              currentUserId={session.user.id}
              isAdmin={isAdmin}
              members={members.map((member) => ({
                id: member.userId,
                label: displayMemberLabel(userMap.get(member.userId)),
              }))}
              compact
              maxMoments={HOME_TIMELINE_MOMENT_LIMIT}
              live={false}
              timezone={calendarSettings.defaultTimezone}
              emptyLabel={emptyTimeline.label}
              emptyAction={{
                href: '/app/timeline',
                label: 'Open timeline',
                body: emptyTimeline.actionBody,
              }}
            />
            <p>
              <Link
                href="/app/timeline"
                className="text-xs text-fg-dim transition-colors hover:text-fg"
              >
                Go to the full timeline
              </Link>
            </p>
          </section>
          <DailyDigestBlock digest={latestDigest?.payload as DailyDigestPayload | undefined} />
        </div>
        <aside
          aria-label="Workspace context"
          className="min-w-0 space-y-6 border-t border-border pt-6 xl:border-t-0 xl:border-l xl:pl-6 xl:pt-0"
        >
          <PinnedWorkspacePreview initialItems={pinnedPage.items.slice(0, 3)} />
          <ConnectAgentOnboardingCard initialData={initialChecklist} />
          <details className="group border-b border-border pb-5">
            <summary className="cursor-pointer text-sm font-medium">Capture by email</summary>
            <div className="pt-4">
              <HomeTeamEmail inboundEmail={inboundEmail} />
            </div>
          </details>

          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Connections & processing
              {(isAdmin ? recoverableJobs.length : 0) + connectionAttention.length > 0 ? (
                <span className="ml-2 text-xs text-danger">
                  {(isAdmin ? recoverableJobs.length : 0) + connectionAttention.length} issues
                </span>
              ) : null}
            </summary>
            <HomeProcessingAttention
              isAdmin={isAdmin}
              recoverableJobs={recoverableJobs.length}
              connectionIssues={connectionAttention.length}
            />
          </details>
          {isAdmin && billingDashboard?.nudge ? (
            <BillingUpgradeNudge nudge={billingDashboard.nudge} />
          ) : null}
          {showPaygSuggestion ? (
            <PaygValueNudge storageKey={`tl-coachmark:payg:${session.user.id}:${active.teamId}`} />
          ) : null}
        </aside>
      </div>
    </div>
  );
}
