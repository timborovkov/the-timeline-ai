import { teams, users } from '@timeline/db';
import { latestDailyDigest, type DailyDigestPayload } from '@timeline/shared/messaging';
import { isConnectorStarterPath, type FirstRunState } from '@timeline/shared/onboarding/first-run';
import { getAudioBucket, getS3PresignClient, getSignedGetObjectUrl } from '@timeline/shared/s3';
import { withTeam, type TeamScope } from '@timeline/shared/team-scope';
import { eq, inArray } from 'drizzle-orm';
import { Boxes, CircleAlert, CircleCheckBig, ListTodo } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

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
import {
  firstRunCaptureHref,
  firstRunCaptureKey,
  firstRunCaptureUnavailable,
} from '@/lib/first-run-links';
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

const HOME_CAPTURE_PHASES = new Set<FirstRunState['phase']>(['processing', 'failed', 'record']);

async function FirstRunHomeBanner({
  firstRun,
  teamId,
  userId,
  teamSlug,
  teamName,
}: {
  firstRun: FirstRunState | null;
  teamId: string;
  userId: string;
  teamSlug: string;
  teamName: string;
}) {
  if (firstRun?.startedByUserId !== userId) return null;
  if (!HOME_CAPTURE_PHASES.has(firstRun.phase)) return null;

  const status =
    firstRun.phase === 'failed'
      ? null
      : await loadHomePanel('home_first_run_status', () =>
          loadFirstRunStatus({ db, teamId, userId, teamSlug, teamName }),
        );
  const current = status?.firstRun ?? firstRun;
  const captureKey = firstRunCaptureKey(current);
  if (!captureKey) return null;
  const steps = status?.record?.processingSteps ?? [];
  const unavailable = firstRunCaptureUnavailable(current, status?.record ?? null);
  const ready = Boolean(current.firstCaptureLandedAt) && !unavailable;
  const failed =
    unavailable || current.phase === 'failed' || steps.some((step) => step.status === 'failed');
  const waitingPath = ready || failed ? null : current.starterPath;

  return (
    <FirstRunHomeCapture
      ready={ready}
      failed={failed}
      emailWaiting={waitingPath === 'email'}
      connectorWaiting={isConnectorStarterPath(waitingPath) ? waitingPath : null}
      startedAt={current.starterSelectedAt}
      completed={steps.filter((step) => step.status === 'done').length}
      total={steps.length}
      href={firstRunCaptureHref(captureKey)}
    />
  );
}

function HomePanelFallback() {
  return <div aria-hidden="true" className="h-12 rounded-sm bg-surface-2" />;
}

function loadHomePanel<T>(operation: string, load: () => Promise<T>): Promise<T | null> {
  return load().catch((err: unknown) => {
    reportCaughtError(err, { surface: 'render', operation });
    return null;
  });
}

type HomeTimezone = ReturnType<TeamScope['calendar']['getCalendarSettings']>;

async function HomeWork({
  scope,
  now,
  calendar,
}: {
  scope: TeamScope;
  now: Date;
  calendar: HomeTimezone;
}) {
  const result = await loadHomePanel('home_work', () =>
    Promise.all([
      calendar.then(({ defaultTimezone }) => getWorkAttentionSummary(scope, now, defaultTimezone)),
      getHomeOpenObjectCounts(scope),
    ]),
  );
  if (!result) return null;
  const [workAttention, openObjectCounts] = result;
  const pendingApprovals = workAttention.pendingApprovals;
  const urgentWorkCount = homeWorkNeedingAttentionCount(workAttention);
  const openObjectTotal = homeOpenObjectTotal(openObjectCounts);
  return (
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
          label: 'Items needing attention',
          singularLabel: 'Item needing attention',
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
          action: 'Browse objects',
          icon: <Boxes aria-hidden="true" />,
        },
      ]}
    />
  );
}

type HomeEvents = ReturnType<TeamScope['timeline']['listEventsPage']>;

async function loadRecentActivity(
  scope: TeamScope,
  eventsPage: HomeEvents,
  calendar: HomeTimezone,
) {
  const [{ items: events }, members, { defaultTimezone: timezone }, role] = await Promise.all([
    eventsPage,
    scope.timeline.listMembers(),
    calendar,
    scope.requireMembership(),
  ]);
  const isAdmin = role === 'owner' || role === 'admin';
  const [impactItems, artifactClusters, audioUrlMap, capturedFiles] = await Promise.all([
    scope.timeline.listImpactItems(events.map((event) => event.id)),
    scope.timeline.listArtifactClusters(events.map((event) => event.id)),
    signAudio(events),
    listTimelineCapturedFilesByEventId({
      db,
      teamId: scope.teamId,
      userId: scope.userId,
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
    timezone: timezone,
  });
  const homeMomentPinState = await scope.pins.isPinnedMany(
    homeMoments.map((moment) => ({ kind: 'timeline_moment' as const, key: moment.id })),
  );

  return {
    events,
    members,
    timezone,
    isAdmin,
    impactItems,
    artifactClusters,
    audioUrlMap,
    capturedFiles,
    userRows,
    userMap,
    homeMoments,
    homeMomentPinState,
  };
}

async function HomeRecentActivity({
  scope,
  eventsPage,
  calendar,
}: {
  scope: TeamScope;
  eventsPage: HomeEvents;
  calendar: HomeTimezone;
}) {
  const result = await loadHomePanel('home_recent_activity', () =>
    loadRecentActivity(scope, eventsPage, calendar),
  );
  if (!result) return null;
  const {
    events,
    members,
    timezone,
    isAdmin,
    impactItems,
    artifactClusters,
    audioUrlMap,
    capturedFiles,
    userRows,
    userMap,
    homeMoments,
    homeMomentPinState,
  } = result;
  const emptyTimeline = homeEmptyTimelineCopy(events.length === 0);
  return (
    <section className="space-y-4 border-t border-border pt-6" aria-label="Recent moments">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Recent activity</h2>
        <Link
          href="/app/timeline"
          className="inline-flex min-h-9 items-center rounded-sm border border-border px-3 text-sm transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
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
        currentUserId={scope.userId}
        isAdmin={isAdmin}
        members={members.map((member) => ({
          id: member.userId,
          label: displayMemberLabel(userMap.get(member.userId)),
        }))}
        compact
        maxMoments={HOME_TIMELINE_MOMENT_LIMIT}
        live={false}
        timezone={timezone}
        emptyLabel={emptyTimeline.label}
        emptyAction={{
          href: '/app/timeline',
          label: 'Open timeline',
          body: emptyTimeline.actionBody,
        }}
      />
    </section>
  );
}

async function HomeDigest({ scope }: { scope: TeamScope }) {
  const digest = await loadHomePanel('home_digest', () =>
    latestDailyDigest({ db, teamId: scope.teamId, userId: scope.userId }),
  );
  return <DailyDigestBlock digest={digest?.payload as DailyDigestPayload | undefined} />;
}

async function HomePins({ scope }: { scope: TeamScope }) {
  const page = await loadHomePanel('home_pins', () => scope.pins.list({ limit: 3 }));
  return page && <PinnedWorkspacePreview initialItems={page.items} />;
}

async function HomeEmail({ teamId }: { teamId: string }) {
  const team = await loadHomePanel('home_email', async () => {
    const [row] = await db
      .select({ slug: teams.slug, inboundEmail: teams.inboundEmail })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    return row ?? null;
  });
  return <HomeTeamEmail inboundEmail={displayInboundEmail(team)} />;
}

async function HomeProcessing({ scope, isAdmin }: { scope: TeamScope; isAdmin: boolean }) {
  const [jobs, connections] = await Promise.all([
    isAdmin
      ? loadHomePanel('home_recoverable_jobs', () => scope.jobRecovery.listRecoverableJobs())
      : null,
    loadHomePanel('home_connections', () => scope.integrations.listConnectionAttention()),
  ]);
  return (
    <HomeProcessingAttention
      isAdmin={isAdmin}
      recoverableJobs={jobs?.length ?? 0}
      connectionIssues={connections?.length ?? 0}
    />
  );
}

type HomeBillingData = Promise<Awaited<ReturnType<TeamScope['billing']['getDashboard']>> | null>;

async function HomeBillingRestriction({ billing }: { billing: HomeBillingData }) {
  const dashboard = await billing;
  return (
    dashboard?.restrictionReason && (
      <BillingRestrictionNotice reason={dashboard.restrictionReason} />
    )
  );
}

async function HomeBillingNudges({
  scope,
  billing,
  isAdmin,
}: {
  scope: TeamScope;
  billing: HomeBillingData;
  isAdmin: boolean;
}) {
  const dashboard = await billing;
  const showPaygSuggestion = await shouldShowPaygSuggestion({
    isAdmin,
    dashboard,
    hasAnswer: () => scope.objects.hasCompletedChatAnswer(),
  });
  return (
    <>
      {isAdmin && dashboard?.nudge ? <BillingUpgradeNudge nudge={dashboard.nudge} /> : null}
      {showPaygSuggestion ? (
        <PaygValueNudge storageKey={`tl-coachmark:payg:${scope.userId}:${scope.teamId}`} />
      ) : null}
    </>
  );
}

type HomeChecklistData = Promise<Awaited<ReturnType<typeof loadOnboardingChecklistView>> | null>;

async function HomeChecklist({ data, agent }: { data: HomeChecklistData; agent?: boolean }) {
  const initialData = await data;
  return agent ? (
    <ConnectAgentOnboardingCard initialData={initialData} />
  ) : (
    <OnboardingChecklist initialData={initialData} />
  );
}

export default async function HomeDashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const [role, webDefault, firstRun] = await Promise.all([
    scope.requireMembership(),
    scope.timeline.resolveVisibilityDefault('web'),
    scope.onboarding.getFirstRun(),
  ]);
  const isAdmin = role === 'owner' || role === 'admin';
  const quickCaptureVisibility = webDefault.visibility === 'private' ? 'private' : 'team';
  const now = new Date();
  const calendar = scope.calendar.getCalendarSettings();
  const eventsPage = scope.timeline.listEventsPage({ limit: HOME_TIMELINE_EVENT_LIMIT, to: now });
  const hasSources = eventsPage
    .then(
      ({ items }) =>
        items.length > 0 ||
        scope.documents.listDocuments({ limit: 1 }).then((docs) => docs.length > 0),
    )
    .catch((err: unknown) => {
      reportCaughtError(err, { surface: 'render', operation: 'home_ask_sources' });
      return true;
    });
  const billing = loadHomePanel('billing_dashboard', () =>
    scope.billing.getDashboard({ canManageBilling: isAdmin }),
  );
  const checklist = loadHomePanel('onboarding_checklist', () =>
    loadOnboardingChecklistView({
      teamId: active.teamId,
      userId: session.user.id,
      getChecklistState: () => scope.onboarding.getChecklistState(),
      starterPath: firstRun?.starterPath ?? null,
    }),
  );

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
                key={active.teamId}
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
        <HomeAskComposer teamId={active.teamId} hasSources={hasSources} />
      </header>

      <Suspense fallback={null}>
        <FirstRunHomeBanner
          firstRun={firstRun}
          teamId={active.teamId}
          userId={session.user.id}
          teamSlug={active.teamSlug}
          teamName={active.teamName}
        />
      </Suspense>
      <Suspense fallback={null}>
        <HomeBillingRestriction billing={billing} />
      </Suspense>
      <Suspense fallback={null}>
        <HomeChecklist data={checklist} />
      </Suspense>

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-8">
          <Suspense fallback={<HomePanelFallback />}>
            <HomeWork scope={scope} now={now} calendar={calendar} />
          </Suspense>
          <Suspense fallback={<HomePanelFallback />}>
            <HomeRecentActivity scope={scope} eventsPage={eventsPage} calendar={calendar} />
          </Suspense>
          <Suspense fallback={null}>
            <HomeDigest scope={scope} />
          </Suspense>
        </div>
        <aside
          aria-label="Workspace context"
          className="min-w-0 space-y-6 border-t border-border pt-6 xl:border-t-0 xl:border-l xl:pl-6 xl:pt-0"
        >
          <Suspense fallback={<HomePanelFallback />}>
            <HomePins scope={scope} />
          </Suspense>
          <Suspense fallback={null}>
            <HomeChecklist data={checklist} agent />
          </Suspense>
          <Suspense fallback={null}>
            <HomeEmail teamId={active.teamId} />
          </Suspense>
          <Suspense fallback={null}>
            <HomeProcessing scope={scope} isAdmin={isAdmin} />
          </Suspense>
          <Suspense fallback={null}>
            <HomeBillingNudges scope={scope} billing={billing} isAdmin={isAdmin} />
          </Suspense>
        </aside>
      </div>
    </div>
  );
}
