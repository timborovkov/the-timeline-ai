import { users } from '@timeline/db';
import {
  digestContentSections,
  digestSummaryParagraphs,
  formatDigestCalendarEvent,
  formatDigestDate,
  formatDigestTask,
  latestDailyDigest,
  type DailyDigestPayload,
} from '@timeline/shared/messaging';
import { getAudioBucket, getS3PresignClient, getSignedGetObjectUrl } from '@timeline/shared/s3';
import { withTeam } from '@timeline/shared/team-scope';
import { inArray } from 'drizzle-orm';
import { CircleAlert, CircleCheckBig, PlugZap, Wrench } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { PinnedBoards } from '@/components/boards/pinned-boards';
import { CaptureForm } from '@/components/capture-form';
import { CaptureDialog } from '@/components/home/capture-dialog';
import { HomeAskComposer } from '@/components/home/home-ask-composer';
import { HomeAttention } from '@/components/home/home-attention';
import { OnboardingChecklist } from '@/components/onboarding-checklist';
import { PageHeader } from '@/components/page-header';
import { SectionHeading } from '@/components/section-heading';
import { TimelineFeed } from '@/components/timeline-feed';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { displayMemberLabel } from '@/lib/display-labels';
import { listTimelineCapturedFilesByEventId } from '@/lib/timeline-captured-files';
import { listWorkQueueObjects } from '@/lib/work-queue';

export const metadata: Metadata = {
  title: 'Home',
  description: 'Ask what changed and review work that needs attention.',
};

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
  const role = await scope.requireMembership();
  const isAdmin = role === 'owner' || role === 'admin';
  const now = new Date();

  const [
    pendingApprovals,
    eventPage,
    members,
    webDefault,
    pinnedBoards,
    latestDigest,
    calendarSettings,
    urgentBoardWork,
    urgentObjectWork,
    connectionAttention,
  ] = await Promise.all([
    scope.suggestions.countPendingSuggestions(),
    scope.timeline.listEventsPage({ limit: 3 }),
    scope.timeline.listMembers(),
    scope.timeline.resolveVisibilityDefault('web'),
    scope.boards.listPinnedBoards(),
    latestDailyDigest({ db, teamId: active.teamId, userId: session.user.id }),
    scope.calendar.getCalendarSettings(),
    scope.boards.listWorkQueueItems({ dueBefore: now, limit: 100 }),
    listWorkQueueObjects(scope.objects, session.user.id, now),
    scope.integrations.listConnectionAttention(),
  ]);
  const recoverableJobs = isAdmin ? await scope.jobRecovery.listRecoverableJobs() : [];
  const events = eventPage.items;

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
  const quickCaptureVisibility = webDefault.visibility === 'private' ? 'private' : 'team';
  const urgentWorkCount = new Set([
    ...urgentBoardWork.map((item) => item.entityId),
    ...urgentObjectWork.map((item) => item.id),
  ]).size;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader title="Home" />
        <div className="shrink-0">
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

      <HomeAskComposer teamId={active.teamId} />

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

      <DailyDigestBlock digest={latestDigest?.payload as DailyDigestPayload | undefined} />

      <div className="grid items-start gap-7 lg:grid-cols-2">
        <PinnedBoards boards={pinnedBoards} />
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
      </div>

      <OnboardingChecklist />
    </div>
  );
}

function DailyDigestBlock({ digest }: { digest: DailyDigestPayload | undefined }) {
  if (!digest?.summary) return null;
  const summary = digestSummaryParagraphs(digest.summary);
  const sections = digestContentSections(digest);
  const keyItems = sections.flatMap((section) => section.items).slice(0, 3);

  return (
    <section
      aria-labelledby="latest-digest-heading"
      className="space-y-3 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionHeading id="latest-digest-heading">Latest digest</SectionHeading>
        <time className="font-mono text-xs text-fg-dim">
          {formatDigestDate(digest.windowEnd, digest.timezone)}
        </time>
      </div>
      <p className="max-w-3xl text-sm leading-6 text-fg-muted">{summary[0]}</p>
      {keyItems.length > 0 ? (
        <ul className="space-y-1 text-sm text-fg">
          {keyItems.map((item, index) => (
            <li key={`${item}:${index}`}>• {item}</li>
          ))}
        </ul>
      ) : null}
      <details className="border-t border-border pt-3 text-sm">
        <summary className="cursor-pointer font-medium text-fg-muted hover:text-fg">
          Complete digest
        </summary>
        <div className="mt-3 grid gap-5 md:grid-cols-2">
          {summary.slice(1).map((paragraph, index) => (
            <p key={`${paragraph}:${index}`} className="text-fg-muted">
              {paragraph}
            </p>
          ))}
          {sections.map((section) => (
            <div key={section.title}>
              <h3 className="font-semibold text-fg">{section.title}</h3>
              <ul className="mt-2 space-y-1 text-fg-muted">
                {section.items.map((item, index) => (
                  <li key={`${item}:${index}`}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
          <DigestList
            label="Current tasks"
            items={digest.tasks.map((task) => formatDigestTask(task, digest.timezone))}
          />
          <DigestList
            label="Upcoming calendar"
            items={digest.upcomingCalendar.map((event) =>
              formatDigestCalendarEvent(event, digest.timezone),
            )}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {digest.links.map((link) => (
            <Button key={link.href} asChild variant="outline" size="sm">
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ))}
        </div>
      </details>
    </section>
  );
}

function DigestList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="font-semibold text-fg">{label}</h3>
      <ul className="mt-2 space-y-1 text-fg-muted">
        {items.map((item, index) => (
          <li key={`${item}:${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
