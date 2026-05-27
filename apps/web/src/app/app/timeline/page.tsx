import { users } from '@timeline/db';
import {
  getAudioBucket,
  getS3PresignClient,
  getSignedGetObjectUrl,
  withTeam,
} from '@timeline/shared';
import { inArray } from 'drizzle-orm';
import { Video } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CaptureForm } from '@/components/capture-form';
import { IndexStrip } from '@/components/index-strip';
import { SearchBar } from '@/components/search-bar';
import { TeamAccessPanel } from '@/components/team-access-panel';
import { TimelineList } from '@/components/timeline-list';
import { TimelineOnboardingChecklist } from '@/components/timeline-onboarding-checklist';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

interface Props {
  searchParams: Promise<{
    author?: string;
    from?: string;
    to?: string;
    /** Prefilled by the ⌘K command bar. SearchBar reads it and auto-runs. */
    q?: string;
  }>;
}

function parseDate(input: string | undefined): Date | undefined {
  if (!input) return undefined;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// `<input type="date">` returns YYYY-MM-DD which parses as midnight UTC.
// For an inclusive end-of-day filter, shift the upper bound to the next
// midnight so the whole selected day's events match.
function parseEndOfDay(input: string | undefined): Date | undefined {
  const d = parseDate(input);
  if (!d) return undefined;
  return new Date(d.getTime() + 24 * 60 * 60 * 1000);
}

// Drop non-UUID `?author=…` values rather than passing them to Postgres,
// which would throw on the UUID cast and 500 the page.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseUuid(input: string | undefined): string | undefined {
  if (!input) return undefined;
  return UUID_RE.test(input) ? input : undefined;
}

export default async function TimelinePage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const sp = await searchParams;
  const scope = withTeam(db, active.teamId, session.user.id);
  const role = await scope.requireMembership();
  const isAdmin = role === 'owner' || role === 'admin';
  const [onboardingState, team] = await Promise.all([
    scope.onboarding.getChecklistState(),
    scope.timeline.team(),
  ]);
  const telegramConnectionCount =
    onboardingState.connectionCounts.telegramUserTeams +
    onboardingState.connectionCounts.telegramChatBindings;
  const integrationConnectionCount =
    onboardingState.connectionCounts.nativeIntegrations +
    onboardingState.connectionCounts.teamMcpServers;

  // Parse once so the indicator chip, the open-state of <details>, the form
  // inputs, and the actual query all agree on what's filtered. Raw
  // `sp.author` may contain a non-UUID, `sp.from`/`sp.to` may contain an
  // unparseable string — those are dropped by the parsers, so binding the
  // form to raw `sp.*` would show invalid values that the feed quietly
  // ignored. We keep two `to` variants because the query wants end-of-day
  // (inclusive upper bound) but the <input type="date"> wants the picked
  // day verbatim.
  const authorFilter = parseUuid(sp.author);
  const fromFilter = parseDate(sp.from);
  const toFilter = parseDate(sp.to);
  const toQueryFilter = parseEndOfDay(sp.to);

  const events = await scope.timeline.listEvents({
    authorUserId: authorFilter,
    from: fromFilter,
    to: toQueryFilter,
  });

  // Format a Date back to the YYYY-MM-DD string the <input type="date">
  // expects. Both `parseDate` and `toISOString()` treat the value as UTC,
  // so this round-trips a user-picked date cleanly.
  const toDateInputValue = (d: Date | undefined): string => (d ? d.toISOString().slice(0, 10) : '');

  const authorIds = Array.from(
    new Set(events.map((e) => e.authorUserId).filter((v): v is string => v !== null)),
  );
  const authorRows =
    authorIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, authorIds))
      : [];
  const authorMap = new Map(authorRows.map((r) => [r.id, r] as const));

  // Sign GET URLs for any audio attachments. Phase 3 generates one per render;
  // when timeline pagination starts to matter (Phase 8) we'll cache these.
  // If S3 isn't configured in this environment, degrade gracefully — render
  // the page without playback URLs rather than 500-ing the entire timeline
  // because one column happens to reference object storage that isn't wired
  // up here.
  const audioEvents = events.filter((e) => e.contentAudioUrl);
  const audioUrlMap = new Map<string, string>();
  if (audioEvents.length > 0) {
    try {
      const s3 = getS3PresignClient();
      const bucket = getAudioBucket();
      const pairs = await Promise.all(
        audioEvents.map(async (e) => {
          try {
            const url = await getSignedGetObjectUrl(s3, bucket, e.contentAudioUrl ?? '', 3600);
            return [e.id, url] as const;
          } catch {
            return [e.id, ''] as const;
          }
        }),
      );
      for (const [id, url] of pairs) if (url) audioUrlMap.set(id, url);
    } catch (err) {
      console.error('[timeline] audio playback unavailable — S3 not configured', err);
    }
  }

  const members = await scope.timeline.listMembers();
  const memberIds = members.map((m) => m.userId);
  const memberRows =
    memberIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, memberIds))
      : [];

  const hasSearch = Boolean(sp.q?.trim());
  const hasFilters = Boolean(authorFilter ?? fromFilter ?? toFilter) || hasSearch;
  const eventCount = events.length;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <IndexStrip
        srLabel={`Timeline · ${active.teamName} · ${eventCount} event${eventCount === 1 ? '' : 's'}${hasSearch ? ` · searching for ${sp.q ?? ''}` : ''}${hasFilters ? ' · filters on' : ''}`}
        segments={[
          { value: 'TIMELINE' },
          { label: 'team', value: active.teamName },
          { label: 'events', value: eventCount },
          ...(hasSearch
            ? ([{ label: 'search', value: sp.q ?? '', signal: true }] as const)
            : ([] as const)),
          ...(hasFilters && !hasSearch
            ? ([{ label: 'filter', value: 'ON', signal: true }] as const)
            : ([] as const)),
        ]}
      />

      {!onboardingState.dismissed ? <TimelineOnboardingChecklist state={onboardingState} /> : null}

      <section
        id="capture"
        aria-label="Capture"
        className="rounded-sm border border-border bg-surface p-4 focus-within:border-border-strong"
      >
        <CaptureForm />
      </section>

      <section aria-label="Team access" className="space-y-3">
        <TeamAccessPanel
          team={team}
          telegramConnectionCount={telegramConnectionCount}
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

      <SearchBar initialQuery={sp.q ?? ''} />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
            Recent activity
          </h2>
          <details className="text-sm" open={hasFilters}>
            <summary className="cursor-pointer list-none rounded-sm px-2 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg">
              Filters{hasFilters ? ' · ON' : ''}
            </summary>
            <form
              method="get"
              className="mt-3 flex flex-wrap items-end gap-3 rounded-sm border border-border bg-surface p-3 text-sm"
            >
              {/* Preserve ⌘K's `q` across filter submissions — the form
                  is plain GET and would otherwise drop any param it
                  doesn't carry an input for. */}
              {sp.q ? <input type="hidden" name="q" value={sp.q} /> : null}
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                  Author
                </span>
                <select
                  name="author"
                  defaultValue={authorFilter ?? ''}
                  className="h-9 rounded-sm border border-border bg-bg px-2 text-sm focus:border-border-strong focus:outline-none"
                >
                  <option value="">Everyone</option>
                  {memberRows.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name ?? m.email}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                  From
                </span>
                <input
                  type="date"
                  name="from"
                  defaultValue={toDateInputValue(fromFilter)}
                  className="h-9 rounded-sm border border-border bg-bg px-2 text-sm font-mono focus:border-border-strong focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                  To
                </span>
                <input
                  type="date"
                  name="to"
                  defaultValue={toDateInputValue(toFilter)}
                  className="h-9 rounded-sm border border-border bg-bg px-2 text-sm font-mono focus:border-border-strong focus:outline-none"
                />
              </label>
              <button
                type="submit"
                className="h-9 rounded-sm border border-border bg-bg px-3 text-sm transition-colors hover:border-border-strong hover:bg-surface-2"
              >
                Apply
              </button>
            </form>
          </details>
        </div>

        <TimelineList
          events={events}
          authorMap={authorMap}
          audioUrlMap={audioUrlMap}
          currentUserId={session.user.id}
          isAdmin={isAdmin}
        />
      </section>
    </div>
  );
}
