import { users } from '@timeline/db';
import { getAudioBucket, getS3PresignClient, getSignedGetObjectUrl } from '@timeline/shared/s3';
import { withTeam } from '@timeline/shared/team-scope';
import { localDateSpanToUtcRange } from '@timeline/shared/time';
import { inArray } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';
import type { ComponentProps } from 'react';

import { Coachmark } from '@/components/coachmark';
import { DebouncedFilterForm } from '@/components/debounced-filter-form';
import { FilterMultiSelect } from '@/components/filter-multi-select';
import { IndexStrip } from '@/components/index-strip';
import { TimelineFeed } from '@/components/timeline-feed';
import { TimelineSourceFilterControls } from '@/components/timeline-source-filter-controls';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { displayMemberLabel } from '@/lib/display-labels';
import { requireRedisQueue } from '@/lib/queue';
import { listTimelineCapturedFilesByEventId } from '@/lib/timeline-captured-files';
import {
  TIMELINE_IMPACT_FILTERS,
  TIMELINE_PRESETS,
  TIMELINE_SOURCES,
  isTimelinePresetActive,
  parseTimelineImpacts,
  parseTimelineOrigins,
  parseTimelineSources,
  timelineHref,
  timelineOriginOptions,
  timelineOriginValue,
  timelineSourceValues,
} from '@/lib/timeline-controls';
import {
  buildTimelineMoments,
  timelineMomentLookupPlan,
  toTimelineMomentDto,
} from '@/lib/timeline-moments';
import { trackTimelineMomentsViewed } from '@/lib/timeline-observability';
import {
  applyCachedTimelineMomentPresentations,
  collectTimelinePage,
  emptyTimelineMomentPresentationCacheStats,
  focusedRelatedEventWindow,
  serializeTimelineEvent,
  type TimelineMomentPresentationCacheStats,
} from '@/lib/timeline-page';

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
    origin?: string;
    impact?: string;
    event?: string;
    q?: string;
    mode?: string;
    moment?: string;
  }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type SearchParams = Awaited<Props['searchParams']>;
type TimelineMode = 'moments' | 'events';
type TimelineUserMap = Map<string, { id: string; name: string | null; email: string }>;
interface TimelineMember {
  userId: string;
}
type TimelineFeedProps = ComponentProps<typeof TimelineFeed>;
interface TimelineBaseParams extends Record<string, string | null | undefined> {
  author: string | null;
  from: string | null;
  to: string | null;
  mode: string | null;
  origin: string | null;
}

function parseTimelineMode(input: string | undefined): TimelineMode {
  return input === 'events' ? 'events' : 'moments';
}

function parseMomentId(input: string | undefined): string | undefined {
  if (!input || input.length > 500) return undefined;
  return input.startsWith('moment:') ? input : undefined;
}

function nextDateInput(input: string): string {
  const d = new Date(`${input}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function parseStartOfDay(input: string | undefined, timezone: string): Date | undefined {
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return undefined;
  try {
    return localDateSpanToUtcRange(input, nextDateInput(input), timezone).from;
  } catch {
    return undefined;
  }
}

function parseEndOfDay(input: string | undefined, timezone: string): Date | undefined {
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return undefined;
  try {
    return localDateSpanToUtcRange(input, nextDateInput(input), timezone).to;
  } catch {
    return undefined;
  }
}

function parseUuid(input: string | undefined): string | undefined {
  if (!input) return undefined;
  return UUID_RE.test(input) ? input : undefined;
}

function parseUuids(input: string | undefined): string[] {
  if (!input) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(',')) {
    const part = raw.trim();
    if (UUID_RE.test(part) && !seen.has(part)) {
      seen.add(part);
      out.push(part);
    }
  }
  return out;
}

function toDateInputValue(input: string | undefined): string {
  return input && /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : '';
}

export default async function TimelinePage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const sp = await searchParams;
  if (sp.q?.trim()) {
    const next = new URLSearchParams({ q: sp.q.trim() });
    if (sp.source) next.set('source', sp.source);
    if (sp.from) next.set('from', sp.from);
    if (sp.to) next.set('to', sp.to);
    redirect(`/app/search?${next.toString()}`);
  }

  const scope = withTeam(db, active.teamId, session.user.id);
  const role = await scope.requireMembership();
  const isAdmin = role === 'owner' || role === 'admin';
  const calendarSettings = await scope.calendar.getCalendarSettings();
  const timezone = calendarSettings.defaultTimezone;

  const authorFilters = parseUuids(sp.author);
  const authorFilterValue = authorFilters.join(',');
  const sourceFilters = parseTimelineSources(sp.source);
  const sourceFilterValue = sourceFilters.join(',');
  const originFilters = parseTimelineOrigins(sp.origin);
  const originFilterValue = originFilters.map(timelineOriginValue).join(',');
  if (originFilters.length > 0 && sourceFilters.length > 0) {
    redirect(timelineHref({ ...sp, source: null }, { origin: originFilterValue }));
  }
  const sourceValues = originFilters.length > 0 ? undefined : timelineSourceValues(sourceFilters);
  const impactFilters = parseTimelineImpacts(sp.impact);
  const impactFilterValue = impactFilters.join(',');
  const focusEventId = parseUuid(sp.event);
  const focusMomentId = parseMomentId(sp.moment);
  const mode = parseTimelineMode(sp.mode);
  const fromFilter = parseStartOfDay(sp.from, timezone);
  const toFilter = parseStartOfDay(sp.to, timezone);
  const toQueryFilter = parseEndOfDay(sp.to, timezone);

  const [timelinePage, members, sourceFacets] = await Promise.all([
    collectTimelinePage({
      impact: impactFilters,
      focusEventId,
      focusMomentId,
      mode,
      timezone,
      fetchPage: async ({ cursor, limit }) => {
        const page = await scope.timeline.listEventsPage({
          authorUserId: authorFilters.length > 0 ? authorFilters : undefined,
          from: fromFilter,
          to: toQueryFilter,
          source: sourceValues,
          origins: originFilters,
          cursor: cursor ?? undefined,
          limit,
        });
        return {
          items: page.items.map(serializeTimelineEvent),
          nextCursor: page.nextCursor,
        };
      },
      fetchEventsByIds: async (eventIds) =>
        (await scope.timeline.getEventsByIds(eventIds)).map(serializeTimelineEvent),
      fetchRelatedEventsForFocus: async (focusedEvent) => {
        const window = focusedRelatedEventWindow(focusedEvent);
        const events = await scope.timeline.listEvents({
          from: window.from,
          to: window.to,
          source: focusedEvent.source,
          limit: 100,
        });
        return events.map(serializeTimelineEvent);
      },
      fetchEventsForMoment: async (momentId) => {
        const plan = timelineMomentLookupPlan(momentId);
        if (!plan) return [];
        const events = await scope.timeline.listEventsForMomentLookup(plan);
        return events.map(serializeTimelineEvent);
      },
      hydrateImpact: (eventIds) => scope.timeline.listImpactItems(eventIds),
    }),
    scope.timeline.listMembers(),
    scope.timeline.listSourceFacets(),
  ]);
  const events = timelinePage.items;
  const eventIds = events.map((event) => event.id);

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
  const [capturedFiles, artifactClusters] = await Promise.all([
    listTimelineCapturedFilesByEventId({
      db,
      teamId: active.teamId,
      userId: session.user.id,
      eventIds,
    }),
    scope.timeline.listArtifactClusters(eventIds),
  ]);

  const hasPanelFilters =
    authorFilters.length > 0 ||
    fromFilter !== undefined ||
    toFilter !== undefined ||
    sourceFilters.length > 0 ||
    originFilters.length > 0 ||
    impactFilters.length > 0;
  const hasFilters = hasPanelFilters;
  const originOptions = timelineOriginOptions(sourceFacets);
  const sourceLabel =
    originFilters.length === 1
      ? originOptions.find((option) => option.value === originFilterValue)?.label
      : originFilters.length > 1
        ? `${String(originFilters.length)} specific sources`
        : sourceFilters.length === 1
          ? TIMELINE_SOURCES.find(([value]) => value === sourceFilters[0])?.[1]
          : sourceFilters.length > 1
            ? `${String(sourceFilters.length)} sources`
            : undefined;
  const eventCount = events.length;
  let presentationCacheStats: TimelineMomentPresentationCacheStats =
    emptyTimelineMomentPresentationCacheStats();
  const initialMoments =
    mode === 'moments'
      ? (
          await applyCachedTimelineMomentPresentations(
            buildTimelineMoments(events, userMap, {
              impactItemsByEventId: timelinePage.impactItems,
              artifactClustersByEventId: artifactClusters,
              timezone,
            }),
            {
              teamId: active.teamId,
              listMomentPresentations: (cacheKeys) =>
                scope.timeline.listMomentPresentations(cacheKeys),
              enqueueMissingPresentation: async ({ cacheKey, rawEventIds }) => {
                const q = await requireRedisQueue();
                await q.enqueueTimelineMomentPresentationJob({
                  teamId: active.teamId,
                  userId: session.user.id,
                  cacheKey,
                  rawEventIds,
                });
              },
              onCacheStats: (stats) => {
                presentationCacheStats = stats;
              },
            },
          )
        ).map(toTimelineMomentDto)
      : [];
  trackTimelineMomentsViewed({
    teamId: active.teamId,
    userId: session.user.id,
    surface: 'page',
    diagnostics: timelinePage.diagnostics,
    presentationCacheStats,
    filters: {
      author: authorFilterValue || null,
      from: sp.from ?? null,
      to: sp.to ?? null,
      source: sourceFilterValue || null,
      origin: originFilterValue || null,
      impact: impactFilterValue || null,
      event: focusEventId ?? null,
      moment: focusMomentId ?? null,
      cursor: null,
    },
  });
  const baseParams = {
    author: authorFilterValue || null,
    from: sp.from ?? null,
    to: sp.to ?? null,
    event: focusEventId ?? null,
    moment: focusMomentId ?? null,
    mode: mode === 'events' ? 'events' : null,
    origin: originFilterValue || null,
  };
  return (
    <div className="space-y-6">
      <IndexStrip
        srLabel={`Timeline · ${active.teamName} · ${eventCount} event${eventCount === 1 ? '' : 's'} loaded${hasFilters ? ' · filters on' : ''}`}
        segments={[
          { value: 'TIMELINE' },
          { label: 'team', value: active.teamName },
          { label: 'loaded', value: eventCount },
          ...(sourceLabel
            ? ([{ label: 'source', value: sourceLabel, signal: true }] as const)
            : []),
          ...(impactFilters.length > 0
            ? ([
                {
                  label: 'impact',
                  value:
                    impactFilters.length === 1
                      ? (impactFilters[0] ?? '')
                      : `${String(impactFilters.length)} kinds`,
                  signal: true,
                },
              ] as const)
            : []),
          ...(hasFilters && !sourceLabel
            ? ([{ label: 'filter', value: 'ON', signal: true }] as const)
            : []),
        ]}
      />

      <Coachmark storageKey="citation-inspector">
        Every claim in the timeline is cited. Click any{' '}
        <span className="font-mono text-signal">[c:...]</span> chip to see the raw source evidence.
        That is the point of this product.
      </Coachmark>

      <TimelineBrowserSection
        sp={sp}
        members={members}
        userMap={userMap}
        baseParams={baseParams}
        hasFilters={hasFilters}
        hasPanelFilters={hasPanelFilters}
        sourceFilters={sourceFilters}
        sourceFilterValue={sourceFilterValue}
        originFilterValue={originFilterValue}
        originOptions={originOptions}
        impactFilters={impactFilters}
        impactFilterValue={impactFilterValue}
        focusEventId={focusEventId}
        focusMomentId={focusMomentId}
        authorFilterValue={authorFilterValue}
        events={events}
        moments={initialMoments}
        nextCursor={timelinePage.nextCursor}
        userRows={userRows}
        audioUrlMap={audioUrlMap}
        impactItems={timelinePage.impactItems}
        artifactClusters={artifactClusters}
        capturedFiles={capturedFiles}
        currentUserId={session.user.id}
        isAdmin={isAdmin}
        timezone={timezone}
        mode={mode}
      />
    </div>
  );
}

function TimelineBrowserSection({
  sp,
  members,
  userMap,
  baseParams,
  hasFilters,
  hasPanelFilters,
  sourceFilters,
  sourceFilterValue,
  originFilterValue,
  originOptions,
  impactFilters,
  impactFilterValue,
  focusEventId,
  focusMomentId,
  authorFilterValue,
  events,
  moments,
  nextCursor,
  userRows,
  audioUrlMap,
  impactItems,
  artifactClusters,
  capturedFiles,
  currentUserId,
  isAdmin,
  timezone,
  mode,
}: {
  sp: SearchParams;
  members: TimelineMember[];
  userMap: TimelineUserMap;
  baseParams: TimelineBaseParams;
  hasFilters: boolean;
  hasPanelFilters: boolean;
  sourceFilters: ReturnType<typeof parseTimelineSources>;
  sourceFilterValue: string;
  originFilterValue: string;
  originOptions: ReturnType<typeof timelineOriginOptions>;
  impactFilters: ReturnType<typeof parseTimelineImpacts>;
  impactFilterValue: string;
  focusEventId: string | undefined;
  focusMomentId: string | undefined;
  authorFilterValue: string;
  events: TimelineFeedProps['initialPage']['items'];
  moments: TimelineFeedProps['initialPage']['moments'];
  nextCursor: TimelineFeedProps['initialPage']['nextCursor'];
  userRows: { id: string; name: string | null; email: string }[];
  audioUrlMap: Map<string, string>;
  impactItems: TimelineFeedProps['initialPage']['impactItems'];
  artifactClusters: TimelineFeedProps['initialPage']['artifactClusters'];
  capturedFiles: TimelineFeedProps['initialPage']['capturedFiles'];
  currentUserId: string;
  isAdmin: boolean;
  timezone: string;
  mode: TimelineMode;
}) {
  return (
    <section className="space-y-3">
      <TimelineFilterPanel
        members={members}
        userMap={userMap}
        baseParams={baseParams}
        hasFilters={hasFilters}
        hasPanelFilters={hasPanelFilters}
        sourceFilterValue={sourceFilterValue}
        originFilterValue={originFilterValue}
        originOptions={originOptions}
        impactFilterValue={impactFilterValue}
        authorFilterValue={authorFilterValue}
        fromValue={toDateInputValue(sp.from)}
        toValue={toDateInputValue(sp.to)}
      />
      <TimelinePresetControls
        baseParams={baseParams}
        mode={mode}
        eventCount={events.length}
        momentCount={moments?.length ?? events.length}
        sourceFilters={sourceFilters}
        impactFilters={impactFilters}
        hasOriginFilter={Boolean(originFilterValue)}
      />
      <TimelineFeed
        initialPage={{
          version: 'timeline_moments_page.v1',
          groupingVersion: 'timeline_grouping.v1',
          mode,
          moments,
          rawEventsById:
            mode === 'moments'
              ? Object.fromEntries(events.map((eventItem) => [eventItem.id, eventItem]))
              : {},
          items: events,
          nextCursor,
          authors: Object.fromEntries(userRows.map((row) => [row.id, row])),
          audioUrls: Object.fromEntries(audioUrlMap),
          impactItems,
          artifactClusters,
          capturedFiles,
        }}
        filters={{
          author: authorFilterValue || null,
          from: sp.from ?? null,
          to: sp.to ?? null,
          source: sourceFilterValue || null,
          origin: originFilterValue || null,
          impact: impactFilterValue || null,
          event: focusEventId ?? null,
          moment: focusMomentId ?? null,
        }}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        members={members.map((member) => {
          const user = userMap.get(member.userId);
          return { id: member.userId, label: displayMemberLabel(user) };
        })}
        impactFilter={impactFilters}
        focusEventId={focusEventId ?? null}
        focusMomentId={focusMomentId ?? null}
        timezone={timezone}
        mode={mode}
        emptyLabel={hasFilters ? 'No events match this view' : 'No events yet'}
        emptyAction={{
          href: hasFilters ? '/app/timeline' : '/app#capture',
          label: hasFilters ? 'Clear timeline filters' : 'Capture first event',
          body: hasFilters
            ? 'The archive is still intact. Clear the filters or broaden your search to see more events.'
            : 'Start from Home with one raw note, decision, or follow-up.',
        }}
      />
    </section>
  );
}

function TimelineFilterPanel({
  members,
  userMap,
  baseParams,
  hasFilters,
  hasPanelFilters,
  sourceFilterValue,
  originFilterValue,
  originOptions,
  impactFilterValue,
  authorFilterValue,
  fromValue,
  toValue,
}: {
  members: TimelineMember[];
  userMap: TimelineUserMap;
  baseParams: TimelineBaseParams;
  hasFilters: boolean;
  hasPanelFilters: boolean;
  sourceFilterValue: string;
  originFilterValue: string;
  originOptions: ReturnType<typeof timelineOriginOptions>;
  impactFilterValue: string;
  authorFilterValue: string;
  fromValue: string;
  toValue: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-fg">Timeline</h2>
      <details className="text-sm" open={hasFilters}>
        <summary className="cursor-pointer list-none rounded-sm px-2 py-1 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg">
          Filters{hasFilters ? ' · On' : ''}
        </summary>
        <DebouncedFilterForm
          basePath="/app/timeline"
          className="mt-3 grid gap-3 rounded-sm border border-border bg-surface p-3 text-sm xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start"
        >
          {baseParams.mode ? <input type="hidden" name="mode" value={baseParams.mode} /> : null}
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <TimelineSourceFilterControls
              key={`timeline-source-filters:${sourceFilterValue}:${originFilterValue}`}
              source={sourceFilterValue}
              origin={originFilterValue}
              originOptions={originOptions}
            />
            <FilterMultiSelect
              key={`timeline-impact:${impactFilterValue}`}
              name="impact"
              label="Impact"
              defaultValue={impactFilterValue}
              placeholder="All impact"
              options={TIMELINE_IMPACT_FILTERS.map((value) => ({ value, label: value }))}
            />
            <FilterMultiSelect
              key={`timeline-author:${authorFilterValue}`}
              name="author"
              label="Author"
              defaultValue={authorFilterValue}
              placeholder="Everyone"
              options={members.map((member) => {
                const user = userMap.get(member.userId);
                return {
                  value: member.userId,
                  label: displayMemberLabel(user),
                };
              })}
            />
            <TimelineDateField name="from" label="From" value={fromValue} />
            <TimelineDateField name="to" label="To" value={toValue} />
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end xl:pt-[1.125rem]">
            {hasPanelFilters ? (
              <Link
                href={timelineHref(baseParams, {
                  author: null,
                  from: null,
                  to: null,
                  source: null,
                  origin: null,
                  impact: null,
                })}
                className="inline-flex h-9 items-center rounded-sm border border-border bg-bg px-3 text-sm text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
              >
                Clear
              </Link>
            ) : null}
          </div>
        </DebouncedFilterForm>
      </details>
    </div>
  );
}

function TimelineDateField({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <input
        type="date"
        name={name}
        defaultValue={value}
        className="h-9 rounded-sm border border-border bg-bg px-2 text-sm font-mono focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      />
    </label>
  );
}

function TimelinePresetControls({
  baseParams,
  mode,
  eventCount,
  momentCount,
  sourceFilters,
  impactFilters,
  hasOriginFilter,
}: {
  baseParams: TimelineBaseParams;
  mode: TimelineMode;
  eventCount: number;
  momentCount: number;
  sourceFilters: ReturnType<typeof parseTimelineSources>;
  impactFilters: ReturnType<typeof parseTimelineImpacts>;
  hasOriginFilter: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-2">
      <nav aria-label="Timeline presets" className="flex flex-wrap gap-1.5">
        {TIMELINE_PRESETS.map((preset) => {
          const href =
            'all' in preset
              ? timelineHref(baseParams, { source: null, origin: null, impact: null })
              : timelineHref(baseParams, {
                  source: preset.source,
                  origin: null,
                  impact: null,
                });
          const active = isTimelinePresetActive(preset, {
            sourceFilters,
            impactCount: impactFilters.length,
            hasOriginFilter,
          });
          return (
            <Link
              key={preset.label}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex min-h-8 items-center rounded-sm border px-2.5 text-xs font-medium transition-colors ${
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
      <p className="min-w-0 flex-1 text-xs leading-5 text-fg-dim md:text-right">
        {mode === 'moments'
          ? `${momentCount} ${momentCount === 1 ? 'moment' : 'moments'} · ${eventCount} source ${eventCount === 1 ? 'event' : 'events'}`
          : `${eventCount} source ${eventCount === 1 ? 'event' : 'events'}`}
      </p>
      <nav
        aria-label="Timeline mode"
        className="flex rounded-sm border border-border bg-surface p-0.5"
      >
        {[
          ['moments', 'Moments'],
          ['events', 'Audit trail'],
        ].map(([value, label]) => {
          const active = mode === value;
          return (
            <Link
              key={value}
              href={timelineHref(baseParams, { mode: value === 'events' ? value : null })}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex min-h-7 items-center rounded-[3px] px-2.5 text-xs transition-colors ${
                active ? 'bg-bg text-fg shadow-sm' : 'text-fg-muted hover:text-fg'
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
