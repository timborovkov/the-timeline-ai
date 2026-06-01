import { users } from '@timeline/db';
import {
  getAudioBucket,
  getS3PresignClient,
  getSignedGetObjectUrl,
  withTeam,
} from '@timeline/shared';
import { inArray } from 'drizzle-orm';
import { CircleCheckBig, Mail, Video } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

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

  const [onboardingState, team, pendingApprovals, eventPage, members, webDefault] =
    await Promise.all([
      scope.onboarding.getChecklistState(),
      scope.timeline.team(),
      scope.suggestions.countPendingSuggestions(),
      scope.timeline.listEventsPage({ limit: 12 }),
      scope.timeline.listMembers(),
      scope.timeline.resolveVisibilityDefault('web'),
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
    <div className="mx-auto max-w-6xl space-y-8">
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

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)]">
        <section
          id="capture"
          aria-label="Capture"
          className="rounded-sm border border-border bg-surface p-4 focus-within:border-border-strong"
        >
          <CaptureForm initialVisibility={quickCaptureVisibility} />
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
          <OnboardingChecklist />
        </section>
      </div>

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
          emptyLabel="NO MOMENTS YET -> CAPTURE ABOVE"
        />
      </section>
    </div>
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
