import { users } from '@timeline/db';
import { latestDailyDigest, type DailyDigestPayload } from '@timeline/shared/messaging';
import { getAudioBucket, getS3PresignClient, getSignedGetObjectUrl } from '@timeline/shared/s3';
import { withTeam } from '@timeline/shared/team-scope';
import { inArray } from 'drizzle-orm';
import {
  Building2,
  CircleAlert,
  CircleCheckBig,
  FolderKanban,
  Handshake,
  ListChecks,
  ListTodo,
  PlugZap,
  UserRound,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { CaptureForm } from '@/components/capture-form';
import { CaptureDialog } from '@/components/home/capture-dialog';
import { DailyDigestBlock } from '@/components/home/daily-digest-block';
import { HomeAskComposer } from '@/components/home/home-ask-composer';
import { HomeAttention } from '@/components/home/home-attention';
import { OnboardingChecklist } from '@/components/onboarding-checklist';
import { PinnedWorkspacePreview } from '@/components/pins/pinned-workspace-preview';
import { SectionHeading } from '@/components/section-heading';
import { TimelineFeed } from '@/components/timeline-feed';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { displayMemberLabel } from '@/lib/display-labels';
import {
  getHomeOpenObjectCounts,
  getWorkAttentionSummary,
  homeOpenObjectHref,
  homeWorkNeedingAttentionCount,
  type HomeOpenObjectType,
} from '@/lib/hub-status';
import { OBJECT_TYPE_LABELS } from '@/lib/object-type-labels';
import { listTimelineCapturedFilesByEventId } from '@/lib/timeline-captured-files';
import { buildTimelineMoments } from '@/lib/timeline-moments';

export const metadata: Metadata = {
  title: 'Home',
  description: 'Ask what changed and review work that needs attention.',
};

const HOME_OPEN_OBJECT_ATTENTION: {
  type: HomeOpenObjectType;
  action: string;
  icon: typeof ListTodo;
}[] = [
  { type: 'task', action: 'Open tasks', icon: ListTodo },
  { type: 'follow_up', action: 'Open follow-ups', icon: ListChecks },
  { type: 'person', action: 'Open people', icon: UserRound },
  { type: 'company', action: 'Open companies', icon: Building2 },
  { type: 'project', action: 'Open projects', icon: FolderKanban },
  { type: 'deal', action: 'Open deals', icon: Handshake },
];

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
  ] = await Promise.all([
    getWorkAttentionSummary(scope, now, calendarSettings.defaultTimezone),
    getHomeOpenObjectCounts(scope),
    scope.timeline.listEventsPage({ limit: 3 }),
    scope.timeline.listMembers(),
    scope.timeline.resolveVisibilityDefault('web'),
    scope.pins.list({ limit: 6 }),
    latestDailyDigest({ db, teamId: active.teamId, userId: session.user.id }),
    scope.integrations.listConnectionAttention(),
  ]);
  const recoverableJobs = isAdmin ? await scope.jobRecovery.listRecoverableJobs() : [];
  const events = eventPage.items;
  const pendingApprovals = workAttention.pendingApprovals;
  const urgentWorkCount = homeWorkNeedingAttentionCount(workAttention);

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
          ...HOME_OPEN_OBJECT_ATTENTION.map(({ type, action, icon: Icon }) => ({
            href: homeOpenObjectHref(type),
            label: `Open ${OBJECT_TYPE_LABELS[type].toLowerCase()}`,
            count: openObjectCounts[type],
            action,
            icon: <Icon aria-hidden="true" />,
          })),
          {
            href: '/app/team/jobs',
            label: 'Recoverable jobs',
            count: recoverableJobs.length,
            action: 'Retry processing',
            icon: <Wrench aria-hidden="true" />,
            danger: true,
          },
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

      <DailyDigestBlock digest={latestDigest?.payload as DailyDigestPayload | undefined} />

      <section className="space-y-3">
        <SectionHeading
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href="/app/timeline">Open timeline</Link>
            </Button>
          }
        >
          Recent moments
        </SectionHeading>
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
          maxMoments={3}
          live={false}
          timezone={calendarSettings.defaultTimezone}
          emptyLabel="No recent moments yet"
        />
      </section>

      <OnboardingChecklist />
    </div>
  );
}
