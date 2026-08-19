import { users } from '@timeline/db';
import { getAudioBucket, getS3PresignClient, getSignedGetObjectUrl } from '@timeline/shared/s3';
import { withTeam } from '@timeline/shared/team-scope';
import { inArray } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';
import type { ComponentProps } from 'react';

import { CollectionToolbar } from '@/components/collections/collection-toolbar';
import { DebouncedFilterForm } from '@/components/debounced-filter-form';
import { FilterMultiSelect } from '@/components/filter-multi-select';
import { TimelineFeed } from '@/components/timeline-feed';
import { TimelineSearchField } from '@/components/timeline-search-field';
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
  TIMELINE_UPCOMING_DAYS,
  isTimelinePresetActive,
  parseTimelineImpacts,
  parseTimelineOrigins,
  parseTimelineSources,
  resolveTimelineDateWindow,
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
  impact: string | null;
  mode: string | null;
  origin: string | null;
  source: string | null;
  to: string | null;
}

function parseTimelineMode(input: string | undefined): TimelineMode {
  return input === 'events' ? 'events' : 'moments';
}

function parseMomentId(input: string | undefined): string | undefined {
  if (!input || input.length > 500) return undefined;
  return input.startsWith('moment:') ? input : undefined;
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
  const dateWindow = resolveTimelineDateWindow(sp, timezone);
  if (dateWindow.wasUpcomingClamped) {
    redirect(timelineHref(sp, { to: dateWindow.effectiveToInput }));
  }
  const fromFilter = dateWindow.from;
  const toQueryFilter = dateWindow.to;

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
    Boolean(dateWindow.effectiveToInput) ||
    sourceFilters.length > 0 ||
    originFilters.length > 0 ||
    impactFilters.length > 0;
  const hasFilters = hasPanelFilters;
  const originOptions = timelineOriginOptions(sourceFacets);
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
  const momentPinState = await scope.pins.isPinnedMany(
    initialMoments.map((moment) => ({ kind: 'timeline_moment' as const, key: moment.id })),
  );
  const pinnedMomentIds = initialMoments.flatMap((moment) =>
    momentPinState[`timeline_moment:${moment.id}`] ? [moment.id] : [],
  );
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
    impact: impactFilterValue || null,
    source: sourceFilterValue || null,
    to: sp.to ?? null,
    event: focusEventId ?? null,
    moment: focusMomentId ?? null,
    mode: mode === 'events' ? 'events' : null,
    origin: originFilterValue || null,
  };
  return (
    <div data-app-layout="flush-top" className="relative">
      <h1 className="sr-only">Timeline</h1>
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
        pinnedMomentIds={pinnedMomentIds}
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
        todayInput={dateWindow.todayInput}
        maxUpcomingInput={dateWindow.maxUpcomingInput}
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
  pinnedMomentIds,
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
  todayInput,
  maxUpcomingInput,
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
  pinnedMomentIds: string[];
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
  todayInput: string;
  maxUpcomingInput: string;
}) {
  return (
    <section>
      <div className="sticky top-0 z-20 -mx-4 bg-bg/95 px-4 backdrop-blur md:-mx-8 md:px-8">
        <TimelineFilterPanel
          members={members}
          userMap={userMap}
          baseParams={baseParams}
          hasPanelFilters={hasPanelFilters}
          sourceFilterValue={sourceFilterValue}
          originFilterValue={originFilterValue}
          originOptions={originOptions}
          impactFilterValue={impactFilterValue}
          authorFilterValue={authorFilterValue}
          fromValue={toDateInputValue(sp.from)}
          toValue={toDateInputValue(sp.to)}
          todayInput={todayInput}
          maxUpcomingInput={maxUpcomingInput}
          mode={mode}
          sourceFilters={sourceFilters}
          impactFilters={impactFilters}
          hasOriginFilter={Boolean(originFilterValue)}
        />
      </div>
      <TimelineFeed
        initialPage={{
          version: 'timeline_moments_page.v1',
          groupingVersion: 'timeline_grouping.v1',
          mode,
          moments,
          pinnedMomentIds,
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
        emptyLabel={
          hasFilters
            ? mode === 'events'
              ? 'No events match this view'
              : 'No moments match this view'
            : mode === 'events'
              ? 'No events yet'
              : 'No moments yet'
        }
        emptyAction={{
          href: hasFilters ? '/app/timeline' : '/app#capture',
          label: hasFilters ? 'Clear timeline filters' : 'Capture first event',
          body: hasFilters
            ? mode === 'events'
              ? 'The archive is still intact. Clear the filters or broaden your search to see more events.'
              : 'The archive is still intact. Clear the filters or broaden your search to see more moments.'
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
  hasPanelFilters,
  sourceFilterValue,
  originFilterValue,
  originOptions,
  impactFilterValue,
  authorFilterValue,
  fromValue,
  toValue,
  todayInput,
  maxUpcomingInput,
  mode,
  sourceFilters,
  impactFilters,
  hasOriginFilter,
}: {
  members: TimelineMember[];
  userMap: TimelineUserMap;
  baseParams: TimelineBaseParams;
  hasPanelFilters: boolean;
  sourceFilterValue: string;
  originFilterValue: string;
  originOptions: ReturnType<typeof timelineOriginOptions>;
  impactFilterValue: string;
  authorFilterValue: string;
  fromValue: string;
  toValue: string;
  todayInput: string;
  maxUpcomingInput: string;
  mode: TimelineMode;
  sourceFilters: ReturnType<typeof parseTimelineSources>;
  impactFilters: ReturnType<typeof parseTimelineImpacts>;
  hasOriginFilter: boolean;
}) {
  const formId = 'timeline-collection-filters';
  const upcomingHref = timelineHref(baseParams, {
    from: todayInput,
    to: maxUpcomingInput,
  });
  const upcomingActive = fromValue === todayInput && toValue === maxUpcomingInput;
  const upcomingClassName = `inline-flex min-h-9 items-center rounded-sm px-2.5 text-xs font-medium transition-colors ${upcomingActive ? 'bg-signal-soft text-signal' : 'text-fg-muted hover:bg-surface hover:text-fg'}`;
  return (
    <DebouncedFilterForm id={formId} basePath="/app/timeline">
      {baseParams.mode ? <input type="hidden" name="mode" value={baseParams.mode} /> : null}
      <CollectionToolbar
        activeFilters={
          hasPanelFilters
            ? [
                {
                  key: 'filters',
                  label: 'Timeline filters',
                  value: upcomingActive
                    ? `Upcoming · ${String(TIMELINE_UPCOMING_DAYS)} days`
                    : 'On',
                  href: timelineHref(baseParams, {
                    author: null,
                    from: null,
                    to: null,
                    source: null,
                    origin: null,
                    impact: null,
                  }),
                },
              ]
            : []
        }
      >
        <CollectionToolbar.Search>
          <TimelineSearchField
            source={sourceFilterValue || null}
            from={fromValue || null}
            to={toValue || null}
          />
        </CollectionToolbar.Search>
        <CollectionToolbar.Filters>
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <TimelineSourceFilterControls
              key={`timeline-source-filters:${sourceFilterValue}:${originFilterValue}`}
              source={sourceFilterValue}
              origin={originFilterValue}
              originOptions={originOptions}
              form={formId}
            />
            <FilterMultiSelect
              key={`timeline-impact:${impactFilterValue}`}
              name="impact"
              label="Impact"
              defaultValue={impactFilterValue}
              placeholder="All impact"
              options={TIMELINE_IMPACT_FILTERS.map((value) => ({ value, label: value }))}
              form={formId}
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
              form={formId}
            />
            <TimelineDateField name="from" label="From" value={fromValue} form={formId} />
            <TimelineDateField
              name="to"
              label="To"
              value={toValue}
              form={formId}
              max={maxUpcomingInput}
            />
            <Link
              href={upcomingHref}
              aria-current={upcomingActive ? 'page' : undefined}
              className={upcomingClassName}
            >
              Upcoming · {TIMELINE_UPCOMING_DAYS} days
            </Link>
          </div>
        </CollectionToolbar.Filters>
        <CollectionToolbar.Actions>
          <nav
            aria-label="Timeline presets"
            className="flex max-w-full flex-nowrap gap-1.5 overflow-x-auto"
          >
            <Link
              href={upcomingHref}
              aria-current={upcomingActive ? 'page' : undefined}
              className={upcomingClassName}
            >
              Upcoming · {TIMELINE_UPCOMING_DAYS} days
            </Link>
            {TIMELINE_PRESETS.map((preset) => {
              const href =
                'all' in preset
                  ? timelineHref(baseParams, { source: null, origin: null, impact: null })
                  : timelineHref(baseParams, { source: preset.source, origin: null, impact: null });
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
                  className={`inline-flex min-h-9 items-center rounded-sm px-2.5 text-xs font-medium transition-colors ${active ? 'bg-signal-soft text-signal' : 'text-fg-muted hover:bg-surface hover:text-fg'}`}
                >
                  {preset.label}
                </Link>
              );
            })}
          </nav>
        </CollectionToolbar.Actions>
        <CollectionToolbar.View>
          <nav aria-label="Timeline view" className="flex rounded-sm bg-surface p-0.5">
            {(
              [
                ['moments', 'Moments'],
                ['events', 'All events'],
              ] as const
            ).map(([value, label]) => {
              const active = mode === value;
              const description =
                value === 'moments'
                  ? 'Moments, grouped related activity'
                  : 'All events, every captured source event';
              return (
                <Link
                  key={value}
                  href={timelineHref(baseParams, { mode: value === 'events' ? value : null })}
                  aria-current={active ? 'page' : undefined}
                  aria-label={description}
                  title={description}
                  className={`inline-flex min-h-8 items-center rounded-[3px] px-2.5 text-xs transition-colors ${active ? 'bg-bg text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </CollectionToolbar.View>
      </CollectionToolbar>
      <div className="sr-only">
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
  );
}

function TimelineDateField({
  name,
  label,
  value,
  form,
  max,
}: {
  name: string;
  label: string;
  value: string;
  form?: string;
  max?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <input
        type="date"
        name={name}
        defaultValue={value}
        form={form}
        max={max}
        className="h-9 rounded-sm border border-border bg-bg px-2 text-sm font-mono focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      />
    </label>
  );
}
