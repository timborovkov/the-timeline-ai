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
import { ArrowRight, CircleCheckBig, Clock, FileText, Mail, Plug, Send, Video } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { PinnedBoards } from '@/components/boards/pinned-boards';
import { CaptureForm } from '@/components/capture-form';
import { IndexStrip } from '@/components/index-strip';
import { OnboardingChecklist } from '@/components/onboarding-checklist';
import { TeamAccessPanel } from '@/components/team-access-panel';
import { TimelineFeed } from '@/components/timeline-feed';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Capture events and review the latest timeline activity.',
};

const FIRST_RUN_GUIDE_TOTAL = 4;

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
  } catch (err) {
    console.error('[home] audio playback unavailable; S3 is not configured', err);
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

  const [
    onboardingState,
    team,
    pendingApprovals,
    eventPage,
    members,
    webDefault,
    pinnedBoards,
    latestDigest,
  ] = await Promise.all([
    scope.onboarding.getChecklistState(),
    scope.timeline.team(),
    scope.suggestions.countPendingSuggestions(),
    scope.timeline.listEventsPage({ limit: 12 }),
    scope.timeline.listMembers(),
    scope.timeline.resolveVisibilityDefault('web'),
    scope.boards.listPinnedBoards(),
    latestDailyDigest({ db, teamId: active.teamId, userId: session.user.id }),
  ]);

  const telegramConnectionCount =
    onboardingState.connectionCounts.telegramUserTeams +
    onboardingState.connectionCounts.telegramChatBindings;
  const slackConnectionCount =
    onboardingState.connectionCounts.slackWorkspaceTeams +
    onboardingState.connectionCounts.slackConversationBindings +
    onboardingState.connectionCounts.slackUserTeams;
  const integrationConnectionCount =
    onboardingState.connectionCounts.nativeIntegrations +
    onboardingState.connectionCounts.teamMcpServers;
  const quickCaptureVisibility = webDefault.visibility === 'private' ? 'private' : 'team';
  const events = eventPage.items;
  const completedSetupCount = onboardingState.steps.filter((step) => step.completed).length;
  const completedGuideCount = countFirstRunGuideCompleted(onboardingState.steps);
  const showFirstRunGuide =
    !onboardingState.dismissed && (events.length === 0 || completedSetupCount < 2);
  const [impactItems, audioUrlMap] = await Promise.all([
    scope.timeline.listImpactItems(events.map((event) => event.id)),
    signAudio(events),
  ]);

  const userIds = Array.from(
    new Set([
      ...events.map((e) => e.authorUserId).filter((v): v is string => v !== null),
      ...members.map((m) => m.userId),
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

  return (
    <div className="mx-auto max-w-6xl space-y-6 md:space-y-8">
      <IndexStrip
        srLabel={`Home dashboard · ${active.teamName} · ${events.length} recent event${events.length === 1 ? '' : 's'} · ${pendingApprovals} pending approval${pendingApprovals === 1 ? '' : 's'}`}
        segments={[
          { value: 'HOME' },
          { label: 'team', value: active.teamName },
          { label: 'recent', value: events.length },
          ...(pendingApprovals > 0
            ? ([{ label: 'attention', value: pendingApprovals, signal: true }] as const)
            : []),
        ]}
      />

      <DailyDigestBlock digest={latestDigest?.payload as DailyDigestPayload | undefined} />

      {showFirstRunGuide ? (
        <FirstRunGuide
          completed={completedGuideCount}
          total={FIRST_RUN_GUIDE_TOTAL}
          inboundEmail={team?.inboundEmail ?? null}
        />
      ) : null}

      <PinnedBoards boards={pinnedBoards} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)]">
        <section
          id="capture"
          aria-label="Capture"
          className="rounded-sm border border-border bg-surface p-3 focus-within:border-border-strong sm:p-4"
        >
          <CaptureForm
            initialVisibility={quickCaptureVisibility}
            currentUser={{
              id: session.user.id,
              name: session.user.name ?? null,
              email: session.user.email ?? '',
            }}
            filters={{}}
          />
        </section>

        <section aria-label="Quick actions" className="space-y-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
            Quick actions
          </h2>
          <div className="grid gap-2">
            <AttentionLink
              href="/app/approvals"
              icon={<CircleCheckBig className="size-4" aria-hidden="true" />}
              label={
                pendingApprovals > 0
                  ? `${pendingApprovals} pending approval${pendingApprovals === 1 ? '' : 's'}`
                  : 'No pending approvals'
              }
              active={pendingApprovals > 0}
            />
            <AttentionLink
              href="/app/work"
              icon={<FileText className="size-4" aria-hidden="true" />}
              label="Work"
            />
            <AttentionLink
              href="/app/calendar"
              icon={<Clock className="size-4" aria-hidden="true" />}
              label="Calendar"
            />
            <AttentionLink
              href="/app/meetings"
              icon={<Video className="size-4" aria-hidden="true" />}
              label="Invite notetaker"
            />
            <AttentionLink
              href="#email-ingest"
              icon={<Mail className="size-4" aria-hidden="true" />}
              label={team?.inboundEmail ? 'Email ingest ready' : 'Configure email ingest'}
            />
          </div>
        </section>
      </div>

      <OnboardingChecklist />

      <section aria-label="Team access" className="space-y-3">
        <TeamAccessPanel
          team={team}
          telegramConnectionCount={telegramConnectionCount}
          slackConnectionCount={slackConnectionCount}
          integrationConnectionCount={integrationConnectionCount}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
            Recent moments
          </h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="/app/timeline">Open timeline</Link>
          </Button>
        </div>
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
          }}
          filters={{}}
          currentUserId={session.user.id}
          isAdmin={isAdmin}
          members={members.map((m) => {
            const u = userMap.get(m.userId);
            return { id: m.userId, label: u?.name ?? u?.email ?? m.userId };
          })}
          compact
          maxMoments={8}
          live={false}
          emptyLabel="NO MOMENTS YET"
          emptyAction={{
            href: '#capture',
            label: 'Capture above',
            body: 'Your first note will appear here immediately, then processing will add search and citations.',
          }}
        />
      </section>
    </div>
  );
}

function countFirstRunGuideCompleted(steps: { step: string; completed: boolean }[]): number {
  const completed = new Set<string>();
  for (const step of steps) {
    if (step.completed) completed.add(step.step);
  }
  return [
    completed.has('first_note'),
    completed.has('email_forwarding'),
    completed.has('first_document'),
    completed.has('first_integration') || completed.has('telegram') || completed.has('slack'),
  ].filter(Boolean).length;
}

function DailyDigestBlock({ digest }: { digest: DailyDigestPayload | undefined }) {
  if (!digest?.summary) return null;
  const timezone = digest.timezone;
  const summaryParagraphs = digestSummaryParagraphs(digest.summary);
  const sections = digestContentSections(digest);
  const sourceEntries = Object.entries(digest.sourceDistribution);
  const objectEntries = Object.entries(digest.objectChangesByType);
  return (
    <details className="group rounded-sm border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
            Daily digest
          </span>
          <span className="mt-1 block text-sm font-medium text-fg">
            {formatDigestDate(digest.windowEnd, timezone)}
          </span>
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted group-open:hidden">
          Open
        </span>
        <span className="hidden font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted group-open:inline">
          Fold
        </span>
      </summary>
      <div className="border-t border-border p-4">
        <div className="max-w-3xl space-y-3 text-sm leading-6 text-fg-muted">
          {summaryParagraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {sections.map((section, index) => (
            <DigestList
              key={`${section.title}-${index}`}
              label={section.title}
              items={section.items}
            />
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <DigestStat label="Events" value={String(digest.eventCount)} />
          <DigestStat label="Approvals" value={String(digest.pendingApprovals)} />
          <DigestStat label="Tasks" value={String(digest.tasks.length)} />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <DigestList
            label="Current tasks"
            items={
              digest.tasks.length
                ? digest.tasks.map((task) => formatDigestTask(task, timezone))
                : ['No current tasks in this digest']
            }
          />
          <DigestList
            label="Upcoming calendar"
            items={
              digest.upcomingCalendar.length
                ? digest.upcomingCalendar.map((event) => formatDigestCalendarEvent(event, timezone))
                : ['No upcoming calendar items']
            }
          />
          <DigestList
            label="Sources"
            items={
              sourceEntries.length
                ? sourceEntries.map(([source, count]) => `${source} · ${count}`)
                : ['No new source activity']
            }
          />
          <DigestList
            label="Objects"
            items={
              objectEntries.length
                ? objectEntries.map(([type, count]) => `${type.replace('_', ' ')} · ${count}`)
                : ['No changed objects']
            }
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {digest.links.map((link) => (
            <Button key={link.href} asChild variant="outline" size="sm">
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ))}
        </div>
      </div>
    </details>
  );
}

function DigestStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border bg-bg px-3 py-2">
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">{label}</p>
      <p className="mt-1 text-lg font-semibold text-fg">{value}</p>
    </div>
  );
}

function DigestList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">{label}</p>
      <ul className="mt-2 space-y-1 text-sm text-fg-muted">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function FirstRunGuide({
  completed,
  total,
  inboundEmail,
}: {
  completed: number;
  total: number;
  inboundEmail: string | null;
}) {
  const steps = [
    {
      href: '#capture',
      label: 'Capture first event',
      detail: 'Start with one raw note. Timeline will file it into the log.',
      icon: <Send className="size-4" aria-hidden="true" />,
      primary: true,
    },
    {
      href: inboundEmail ? '#email-ingest' : '/app/team',
      label: 'Forward email',
      detail: inboundEmail ?? 'Open team settings to finish email ingest.',
      icon: <Mail className="size-4" aria-hidden="true" />,
    },
    {
      href: '/app/documents',
      label: 'Upload a document',
      detail: 'Add source material the agent can cite later.',
      icon: <FileText className="size-4" aria-hidden="true" />,
    },
    {
      href: '/app/team/integrations',
      label: 'Connect sources',
      detail: 'Slack, Telegram, MCP servers, and native integrations.',
      icon: <Plug className="size-4" aria-hidden="true" />,
    },
  ];

  return (
    <section className="border border-border bg-surface">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
            Start here · {completed}/{total} complete
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-fg">
            Build the first useful timeline in minutes.
          </h1>
        </div>
        <Button asChild size="sm">
          <Link href="#capture">
            <Send aria-hidden="true" className="size-4" />
            Capture first event
          </Link>
        </Button>
      </div>
      <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step) => (
          <Link
            key={step.label}
            href={step.href}
            className={`group flex min-h-24 flex-col justify-between bg-bg p-3 transition-colors hover:bg-surface-2 ${
              step.primary ? 'text-fg' : 'text-fg-muted'
            }`}
          >
            <span className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm font-medium">
                {step.icon}
                {step.label}
              </span>
              <ArrowRight
                aria-hidden="true"
                className="size-3.5 text-fg-dim transition-transform group-hover:translate-x-0.5 group-hover:text-fg"
              />
            </span>
            <span className="mt-3 text-xs leading-5 text-fg-muted">{step.detail}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function AttentionLink({
  href,
  icon,
  label,
  active = false,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex min-h-11 items-center justify-between gap-3 rounded-sm border px-3 py-2 text-sm transition-colors ${
        active
          ? 'border-signal/40 bg-signal-soft text-signal hover:bg-signal/20'
          : 'border-border bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg'
      }`}
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span className="font-mono text-[11px] uppercase tracking-[0.12em]">Open</span>
    </Link>
  );
}
