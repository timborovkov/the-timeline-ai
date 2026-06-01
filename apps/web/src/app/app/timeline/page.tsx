import { users } from '@timeline/db';
import {
  getAudioBucket,
  getS3PresignClient,
  getSignedGetObjectUrl,
  withTeam,
} from '@timeline/shared';
import { inArray } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { IndexStrip } from '@/components/index-strip';
import { SearchBar } from '@/components/search-bar';
import { TimelineFeed } from '@/components/timeline-feed';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  TIMELINE_IMPACT_FILTERS,
  TIMELINE_PRESETS,
  TIMELINE_SOURCES,
  parseTimelineDensity,
  parseTimelineImpact,
  parseTimelineSource,
  timelineHref,
} from '@/lib/timeline-controls';
import { collectTimelinePage, serializeTimelineEvent } from '@/lib/timeline-page';

export const metadata: Metadata = {
  title: 'Timeline',
  description: 'Explore and filter the team timeline.',
};

interface Props {
  searchParams: Promise<{
    author?: string;
    from?: string;
    to?: string;
    source?: string;
    impact?: string;
    density?: string;
    /** Prefilled by the ⌘K command bar. SearchBar reads it and auto-runs. */
    q?: string;
  }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseDate(input: string | undefined): Date | undefined {
  if (!input) return undefined;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseEndOfDay(input: string | undefined): Date | undefined {
  const d = parseDate(input);
  if (!d) return undefined;
  return new Date(d.getTime() + 24 * 60 * 60 * 1000);
}

function parseUuid(input: string | undefined): string | undefined {
  if (!input) return undefined;
  return UUID_RE.test(input) ? input : undefined;
}

function toDateInputValue(d: Date | undefined): string {
  return d ? d.toISOString().slice(0, 10) : '';
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

  const authorFilter = parseUuid(sp.author);
  const sourceFilter = parseTimelineSource(sp.source);
  const impactFilter = parseTimelineImpact(sp.impact);
  const density = parseTimelineDensity(sp.density);
  const fromFilter = parseDate(sp.from);
  const toFilter = parseDate(sp.to);
  const toQueryFilter = parseEndOfDay(sp.to);

  const [timelinePage, members] = await Promise.all([
    collectTimelinePage({
      impact: impactFilter,
      fetchPage: async ({ cursor, limit }) => {
        const page = await scope.timeline.listEventsPage({
          authorUserId: authorFilter,
          from: fromFilter,
          to: toQueryFilter,
          source: sourceFilter,
          cursor: cursor ?? undefined,
          limit,
        });
        return {
          items: page.items.map(serializeTimelineEvent),
          nextCursor: page.nextCursor,
        };
      },
      hydrateImpact: (eventIds) => scope.timeline.listImpactItems(eventIds),
    }),
    scope.timeline.listMembers(),
  ]);
  const events = timelinePage.items;

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
  const userMap = new Map(userRows.map((m) => [m.id, m] as const));

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
      console.error('[timeline] audio playback unavailable; S3 is not configured', err);
    }
  }

  const hasSearch = Boolean(sp.q?.trim());
  const hasPanelFilters = Boolean(
    authorFilter ?? fromFilter ?? toFilter ?? sourceFilter ?? impactFilter,
  );
  const hasFilters = hasPanelFilters || hasSearch;
  const sourceLabel = TIMELINE_SOURCES.find(([value]) => value === sourceFilter)?.[1];
  const eventCount = events.length;
  const trimmedQuery = sp.q?.trim();
  const baseParams = {
    q: trimmedQuery === '' ? null : trimmedQuery,
    author: authorFilter ?? null,
    from: sp.from ?? null,
    to: sp.to ?? null,
    density: density === 'dense' ? 'dense' : null,
  };
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <IndexStrip
        srLabel={`Timeline · ${active.teamName} · ${eventCount} event${eventCount === 1 ? '' : 's'} loaded${hasSearch ? ` · searching for ${sp.q ?? ''}` : ''}${hasFilters ? ' · filters on' : ''}`}
        segments={[
          { value: 'TIMELINE' },
          { label: 'team', value: active.teamName },
          { label: 'loaded', value: eventCount },
          ...(sourceLabel
            ? ([{ label: 'source', value: sourceLabel, signal: true }] as const)
            : []),
          ...(impactFilter
            ? ([{ label: 'impact', value: impactFilter, signal: true }] as const)
            : []),
          ...(hasSearch ? ([{ label: 'search', value: sp.q ?? '', signal: true }] as const) : []),
          ...(hasFilters && !hasSearch && !sourceLabel
            ? ([{ label: 'filter', value: 'ON', signal: true }] as const)
            : []),
        ]}
        trailing={
          <Button asChild variant="outline" size="sm">
            <Link href="/app#capture">Capture</Link>
          </Button>
        }
      />

      <SearchBar initialQuery={sp.q ?? ''} />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
            Moment browser
          </h2>
          <details className="text-sm" open={hasFilters}>
            <summary className="cursor-pointer list-none rounded-sm px-2 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg">
              Filters{hasFilters ? ' · ON' : ''}
            </summary>
            <form
              method="get"
              className="mt-3 flex flex-wrap items-end gap-3 rounded-sm border border-border bg-surface p-3 text-sm"
            >
              {sp.q ? <input type="hidden" name="q" value={sp.q} /> : null}
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                  Source
                </span>
                <select
                  name="source"
                  defaultValue={sourceFilter ?? ''}
                  className="h-9 rounded-sm border border-border bg-bg px-2 text-sm focus:border-border-strong focus:outline-none"
                >
                  <option value="">All sources</option>
                  {TIMELINE_SOURCES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                  Impact
                </span>
                <select
                  name="impact"
                  defaultValue={impactFilter ?? ''}
                  className="h-9 rounded-sm border border-border bg-bg px-2 text-sm focus:border-border-strong focus:outline-none"
                >
                  <option value="">All impact</option>
                  {TIMELINE_IMPACT_FILTERS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
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
                  {members.map((m) => {
                    const u = userMap.get(m.userId);
                    return (
                      <option key={m.userId} value={m.userId}>
                        {u?.name ?? u?.email ?? m.userId}
                      </option>
                    );
                  })}
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
              <input type="hidden" name="density" value={density} />
              {hasPanelFilters ? (
                <Link
                  href={timelineHref(
                    { q: baseParams.q, density: baseParams.density },
                    { author: null, from: null, to: null, source: null, impact: null },
                  )}
                  className="inline-flex h-9 items-center rounded-sm border border-border px-3 text-sm transition-colors hover:bg-surface-2"
                >
                  Clear
                </Link>
              ) : null}
            </form>
          </details>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-2">
          <nav aria-label="Timeline presets" className="flex flex-wrap gap-1.5">
            {TIMELINE_PRESETS.map((preset) => {
              const href =
                'all' in preset
                  ? timelineHref(baseParams, { source: null, impact: null })
                  : timelineHref(baseParams, {
                      source: 'source' in preset ? preset.source : null,
                      impact: 'impact' in preset ? preset.impact : null,
                    });
              const active =
                ('source' in preset && preset.source === sourceFilter) ||
                ('impact' in preset && preset.impact === impactFilter) ||
                ('all' in preset && !sourceFilter && !impactFilter);
              return (
                <Link
                  key={preset.label}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex min-h-8 items-center rounded-sm border px-2.5 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
                    active
                      ? 'border-signal/50 bg-signal-soft text-signal'
                      : 'border-border text-fg-muted hover:bg-surface hover:text-fg'
                  }`}
                >
                  {preset.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-1 rounded-sm border border-border p-1">
            {(['comfortable', 'dense'] as const).map((value) => (
              <Link
                key={value}
                href={timelineHref(
                  { ...baseParams, source: sourceFilter ?? null, impact: impactFilter ?? null },
                  { density: value === 'dense' ? 'dense' : null },
                )}
                aria-current={density === value ? 'page' : undefined}
                className={`inline-flex h-7 items-center rounded-sm px-2 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
                  density === value
                    ? 'bg-surface-2 text-fg'
                    : 'text-fg-dim hover:bg-surface hover:text-fg'
                }`}
              >
                {value}
              </Link>
            ))}
          </div>
        </div>

        <TimelineFeed
          initialPage={{
            items: events,
            nextCursor: timelinePage.nextCursor,
            authors: Object.fromEntries(userRows.map((row) => [row.id, row])),
            audioUrls: Object.fromEntries(audioUrlMap),
            impactItems: timelinePage.impactItems,
          }}
          filters={{
            author: authorFilter ?? null,
            from: sp.from ?? null,
            to: sp.to ?? null,
            source: sourceFilter ?? null,
            impact: impactFilter ?? null,
          }}
          currentUserId={session.user.id}
          isAdmin={isAdmin}
          members={members.map((m) => {
            const u = userMap.get(m.userId);
            return { id: m.userId, label: u?.name ?? u?.email ?? m.userId };
          })}
          density={density}
          impactFilter={impactFilter ?? 'all'}
        />
      </section>
    </div>
  );
}
