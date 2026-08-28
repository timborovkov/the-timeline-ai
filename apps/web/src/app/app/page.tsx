import { teams, users } from '@timeline/db';
import { latestDailyDigest, type DailyDigestPayload } from '@timeline/shared/messaging';
import { getAudioBucket, getS3PresignClient, getSignedGetObjectUrl } from '@timeline/shared/s3';
import { withTeam } from '@timeline/shared/team-scope';
import { eq, inArray } from 'drizzle-orm';
import { Boxes, CircleAlert, CircleCheckBig, ListTodo, PlugZap, Wrench } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { CaptureForm } from '@/components/capture-form';
import { CaptureDialog } from '@/components/home/capture-dialog';
import { DailyDigestBlock } from '@/components/home/daily-digest-block';
import { HomeAskComposer } from '@/components/home/home-ask-composer';
import { HomeAttention } from '@/components/home/home-attention';
import { HomeTeamEmail } from '@/components/home/home-team-email';
import { OnboardingChecklist } from '@/components/onboarding-checklist';
import { PinnedWorkspacePreview } from '@/components/pins/pinned-workspace-preview';
import { TimelineFeed } from '@/components/timeline-feed';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { displayMemberLabel } from '@/lib/display-labels';
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
const HOME_TIMELINE_MOMENT_LIMIT = 8;

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
    teamRow,
  ] = await Promise.all([
    getWorkAttentionSummary(scope, now, calendarSettings.defaultTimezone),
    getHomeOpenObjectCounts(scope),
    scope.timeline.listEventsPage({ limit: HOME_TIMELINE_EVENT_LIMIT }),
    scope.timeline.listMembers(),
    scope.timeline.resolveVisibilityDefault('web'),
    scope.pins.list({ limit: 6 }),
    latestDailyDigest({ db, teamId: active.teamId, userId: session.user.id }),
    scope.integrations.listConnectionAttention(),
    loadOnboardingChecklistView({
      teamId: active.teamId,
      userId: session.user.id,
      getChecklistState: () => scope.onboarding.getChecklistState(),
    }).catch((err: unknown) => {
      reportCaughtError(err, { surface: 'render', operation: 'onboarding_checklist' });
      return null;
    }),
    isAdmin ? scope.jobRecovery.listRecoverableJobs() : Promise.resolve([]),
    db
      .select({ slug: teams.slug, inboundEmail: teams.inboundEmail })
      .from(teams)
      .where(eq(teams.id, active.teamId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);
  const inboundEmail = displayInboundEmail(teamRow, process.env.POSTMARK_INBOUND_ADDRESS);
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

  return (
    <div className="space-y-8">
      <h1 className="sr-only">Home</h1>
      <HomeAskComposer
        teamId={active.teamId}
        actions={
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
        }
      />

      <OnboardingChecklist initialData={initialChecklist} />

      <HomeAttention
        groups={[
          {
            href: '/app/approvals',
            label: 'Pending approvals',
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
            count: openObjectCounts.task,
            action: 'Open tasks',
            icon: <ListTodo aria-hidden="true" />,
          },
          {
            href: '/app/objects',
            label: 'Open objects',
            count: openObjectTotal,
            action: 'People, companies, projects, and more',
            icon: <Boxes aria-hidden="true" />,
          },
          ...(isAdmin
            ? [
                {
                  href: '/app/team/jobs',
                  label: 'Recoverable jobs',
                  count: recoverableJobs.length,
                  action: 'Retry processing',
                  icon: <Wrench aria-hidden="true" />,
                  danger: true,
                },
              ]
            : []),
          {
            href: '/app/sources',
            label: 'Connection issues',
            count: connectionAttention.length,
            action: 'Repair connections',
            icon: <PlugZap aria-hidden="true" />,
            danger: true,
          },
        ]}
      />

      <PinnedWorkspacePreview initialItems={pinnedPage.items} />

      <HomeTeamEmail inboundEmail={inboundEmail} />

      <DailyDigestBlock digest={latestDigest?.payload as DailyDigestPayload | undefined} />

      <section className="space-y-2" aria-label="Recent moments">
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
          emptyLabel="No recent moments yet"
          emptyAction={{
            href: '/app/timeline',
            label: 'Open timeline',
            body: 'Moments will appear here as the timeline collects work from capture and connected sources.',
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
    </div>
  );
}
