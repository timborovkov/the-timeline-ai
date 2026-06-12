import { users } from '@timeline/db';
import { getAudioBucket, getS3PresignClient, getSignedGetObjectUrl } from '@timeline/shared/s3';
import { withTeam } from '@timeline/shared/team-scope';
import { inArray } from 'drizzle-orm';
import { ArrowRight, CircleCheckBig, FileText, Mail, Plug, Send, Video } from 'lucide-react';
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

  const [onboardingState, team, pendingApprovals, eventPage, members, webDefault, pinnedBoards] =
    await Promise.all([
      scope.onboarding.getChecklistState(),
      scope.timeline.team(),
      scope.suggestions.countPendingSuggestions(),
      scope.timeline.listEventsPage({ limit: 12 }),
      scope.timeline.listMembers(),
      scope.timeline.resolveVisibilityDefault('web'),
      scope.boards.listPinnedBoards(),
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

        <section aria-label="Needs attention" className="space-y-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
            Needs attention
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
        <div className="flex justify-end">
          <Button asChild variant="outline">
            <Link href="/app/meetings">
              <Video aria-hidden="true" />
              Invite notetaker
            </Link>
          </Button>
        </div>
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
