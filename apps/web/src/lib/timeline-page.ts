import { encodeCursor } from '@timeline/shared/pagination';
import {
  applyTimelineMomentPresentationCache,
  buildTimelineMomentPresentationCacheFingerprint,
  buildTimelineMomentPresentationCacheKey,
  timelineMomentPresentationEligibility,
  type TimelineMomentPresentationCacheKey,
  type TimelineMomentPresentationCacheRecord,
} from '@timeline/shared/timeline-moments/presentation';

import type {
  ImpactItem,
  ImpactKind,
  TimelineMoment,
  TimelineMomentDiagnostic,
} from '@/lib/timeline-moments';
import type { TimelineEvent } from '@/lib/use-paginated-queries';

import {
  buildTimelineMoments,
  filterTimelineMomentsByImpact,
  timelineGroupKey,
  timelineMomentDiagnostics,
} from '@/lib/timeline-moments';

interface TimelinePageData {
  items: TimelineEvent[];
  nextCursor: string | null;
  impactItems: Record<string, ImpactItem[]>;
  diagnostics: TimelinePageDiagnostics;
}

export interface TimelinePageDiagnostics {
  mode: 'moments' | 'events';
  scannedPageCount: number;
  scannedRawEventCount: number;
  returnedRawEventCount: number;
  returnedMomentCount: number | null;
  maxScanPagesReached: boolean;
  boundaryCursorAdjusted: boolean;
  providerMetadata: TimelineProviderMetadataDiagnostics;
}

interface TimelineProviderMetadataDiagnostics {
  total: number;
  affectedEventCount: number;
  byProvider: Record<
    string,
    {
      count: number;
      missingFields: Record<string, number>;
    }
  >;
  diagnostics: TimelineMomentDiagnostic[];
}

export interface TimelineMomentPresentationCacheStats {
  hitCount: number;
  missCount: number;
  staleCount: number;
  eligibleMissCount: number;
  queuedMissingCount: number;
  visibilityPartitionCount: number;
}

interface TimelinePageWindow {
  items: TimelineEvent[];
  nextCursor: string | null;
}

interface CollectTimelinePageOptions {
  cursor?: string | null;
  focusEventId?: string | null;
  impact?: ImpactKind | ImpactKind[] | null;
  mode?: 'moments' | 'events';
  timezone?: string;
  limit?: number;
  maxScanPages?: number;
  pageSize?: number;
  focusMomentId?: string | null;
  fetchPage: (input: { cursor: string | null; limit: number }) => Promise<TimelinePageWindow>;
  fetchEventsByIds?: (eventIds: string[]) => Promise<TimelineEvent[]>;
  fetchRelatedEventsForFocus?: (event: TimelineEvent) => Promise<TimelineEvent[]>;
  fetchEventsForMoment?: (momentId: string) => Promise<TimelineEvent[]>;
  cursorForEvent?: (event: TimelineEvent) => string;
  hydrateImpact: (eventIds: string[]) => Promise<Record<string, ImpactItem[]>>;
}

interface SerializableTimelineEvent {
  id: string;
  teamId: string;
  authorUserId: string | null;
  source: TimelineEvent['source'];
  contentText: string | null;
  contentAudioUrl: string | null;
  occurredAt: Date;
  createdAt: Date;
  visibility: TimelineEvent['visibility'];
  visibilityUserIds: string[] | null;
  visibilityOwnerUserId: string | null;
  sourceMetadata: unknown;
}

const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_MAX_SCAN_PAGES = 10;

export function serializeTimelineEvent(event: SerializableTimelineEvent): TimelineEvent {
  return {
    ...event,
    occurredAt: event.occurredAt.toISOString(),
    createdAt: event.createdAt.toISOString(),
  };
}

export async function applyCachedTimelineMomentPresentations(
  moments: TimelineMoment[],
  input: {
    teamId: string;
    listMomentPresentations: (
      cacheKeys: TimelineMomentPresentationCacheKey[],
    ) => Promise<Record<string, TimelineMomentPresentationCacheRecord>>;
    enqueueMissingPresentation?: (input: {
      cacheKey: TimelineMomentPresentationCacheKey;
      rawEventIds: string[];
    }) => Promise<void>;
    onCacheStats?: (stats: TimelineMomentPresentationCacheStats) => void;
  },
): Promise<TimelineMoment[]> {
  if (moments.length === 0) return moments;
  const cacheKeys = moments.map((moment) =>
    buildTimelineMomentPresentationCacheKey({ teamId: input.teamId, moment }),
  );
  const presentations = await input.listMomentPresentations(cacheKeys);
  const missingJobs: Promise<void>[] = [];
  const stats: TimelineMomentPresentationCacheStats = {
    hitCount: 0,
    missCount: 0,
    staleCount: 0,
    eligibleMissCount: 0,
    queuedMissingCount: 0,
    visibilityPartitionCount: new Set(cacheKeys.map((key) => key.visibilityScopeHash)).size,
  };
  const presented = moments.map((moment, index) => {
    const cacheKey = cacheKeys[index];
    if (!cacheKey) return moment;
    const cacheFingerprint = buildTimelineMomentPresentationCacheFingerprint(cacheKey);
    const record = presentations[cacheFingerprint];
    if (!record) {
      stats.missCount += 1;
      const eligibility = timelineMomentPresentationEligibility(moment);
      if (eligibility.eligible) stats.eligibleMissCount += 1;
      if (input.enqueueMissingPresentation && eligibility.eligible) {
        stats.queuedMissingCount += 1;
        missingJobs.push(
          input
            .enqueueMissingPresentation({
              cacheKey,
              rawEventIds: moment.rawEvents.map((event) => event.id),
            })
            .catch(() => undefined),
        );
      }
      return moment;
    }
    const applied = applyTimelineMomentPresentationCache(moment, record, {
      teamId: input.teamId,
    });
    if (applied === moment) {
      stats.staleCount += 1;
    } else {
      stats.hitCount += 1;
    }
    return applied;
  });
  input.onCacheStats?.(stats);
  if (missingJobs.length > 0) await Promise.all(missingJobs);
  return presented;
}

export function emptyTimelineMomentPresentationCacheStats(): TimelineMomentPresentationCacheStats {
  return {
    hitCount: 0,
    missCount: 0,
    staleCount: 0,
    eligibleMissCount: 0,
    queuedMissingCount: 0,
    visibilityPartitionCount: 0,
  };
}

export async function collectTimelinePage({
  cursor = null,
  focusEventId = null,
  impact = null,
  mode = 'moments',
  timezone,
  limit = DEFAULT_PAGE_SIZE,
  maxScanPages = DEFAULT_MAX_SCAN_PAGES,
  pageSize = DEFAULT_PAGE_SIZE,
  focusMomentId = null,
  fetchPage,
  fetchEventsByIds,
  fetchRelatedEventsForFocus,
  fetchEventsForMoment,
  cursorForEvent,
  hydrateImpact,
}: CollectTimelinePageOptions): Promise<TimelinePageData> {
  const hasImpactFilter = Array.isArray(impact) ? impact.length > 0 : Boolean(impact);
  if (!hasImpactFilter) {
    if (mode === 'moments') {
      const page = await collectMomentBackedPage({
        cursor,
        focusEventId,
        limit,
        maxScanPages,
        pageSize,
        timezone,
        focusMomentId,
        fetchPage,
        fetchEventsByIds,
        fetchRelatedEventsForFocus,
        fetchEventsForMoment,
        cursorForEvent,
        hydrateImpact,
      });
      return page;
    }
    const page = await fetchPage({ cursor, limit });
    const items = await includeFocusedEvents(page.items, focusEventId, fetchEventsByIds);
    return {
      items,
      nextCursor: page.nextCursor,
      impactItems: await hydrateImpact(items.map((event) => event.id)),
      diagnostics: {
        mode: 'events',
        scannedPageCount: 1,
        scannedRawEventCount: page.items.length,
        returnedRawEventCount: items.length,
        returnedMomentCount: null,
        maxScanPagesReached: false,
        boundaryCursorAdjusted: false,
        providerMetadata: summarizeProviderMetadataDiagnostics(items, timezone),
      },
    };
  }

  const scannedEvents = new Map<string, TimelineEvent>();
  const impactItems: Record<string, ImpactItem[]> = {};
  let scanCursor = cursor;
  let nextCursor: string | null = null;
  let matchingMoments: TimelineMoment[] = [];
  let scannedPageCount = 0;
  let maxScanPagesReached = false;
  const impactFilter = impact ?? 'all';

  for (let scanned = 0; scanned < maxScanPages; scanned++) {
    const page = await fetchPage({ cursor: scanCursor, limit: pageSize });
    scannedPageCount = scanned + 1;
    const pageImpactItems = await hydrateImpact(page.items.map((event) => event.id));
    Object.assign(impactItems, pageImpactItems);
    for (const event of page.items) scannedEvents.set(event.id, event);

    matchingMoments = filterTimelineMomentsByImpact(
      buildTimelineMoments([...scannedEvents.values()], new Map(), {
        impactItemsByEventId: impactItems,
        timezone,
        groupingMode: mode,
      }),
      impactFilter,
    );

    nextCursor = page.nextCursor;
    if (!nextCursor || matchingMoments.length >= limit) break;
    if (scanned + 1 >= maxScanPages) maxScanPagesReached = true;
    scanCursor = nextCursor;
  }

  const collected = new Map<string, TimelineEvent>();
  for (const moment of matchingMoments) {
    for (const event of moment.rawEvents) collected.set(event.id, event);
  }
  const focusedEvents = await includeFocusedEvents([], focusEventId, fetchEventsByIds);
  for (const event of focusedEvents) {
    collected.set(event.id, event);
  }
  if (focusedEvents.length > 0) {
    Object.assign(impactItems, await hydrateImpact(focusedEvents.map((event) => event.id)));
  }
  const focusedMomentIdEvents = await focusedMomentIdTargetEvents({
    selectedEvents: Array.from(collected.values()),
    focusMomentId,
    timezone,
    fetchEventsForMoment,
  });
  for (const event of focusedMomentIdEvents) {
    collected.set(event.id, event);
  }
  if (focusedMomentIdEvents.length > 0) {
    Object.assign(impactItems, await hydrateImpact(focusedMomentIdEvents.map((event) => event.id)));
  }

  const items = Array.from(collected.values()).sort(
    (a: TimelineEvent, b: TimelineEvent) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
  return {
    items,
    nextCursor,
    impactItems,
    diagnostics: {
      mode,
      scannedPageCount,
      scannedRawEventCount: scannedEvents.size,
      returnedRawEventCount: items.length,
      returnedMomentCount: matchingMoments.length,
      maxScanPagesReached,
      boundaryCursorAdjusted: false,
      providerMetadata: summarizeProviderMetadataDiagnostics([...scannedEvents.values()], timezone),
    },
  };
}

async function collectMomentBackedPage({
  cursor,
  focusEventId,
  focusMomentId,
  limit,
  maxScanPages,
  pageSize,
  timezone,
  fetchPage,
  fetchEventsByIds,
  fetchRelatedEventsForFocus,
  fetchEventsForMoment,
  cursorForEvent = timelineCursorForEvent,
  hydrateImpact,
}: Required<
  Pick<
    CollectTimelinePageOptions,
    'limit' | 'maxScanPages' | 'pageSize' | 'fetchPage' | 'hydrateImpact'
  >
> &
  Pick<
    CollectTimelinePageOptions,
    | 'cursor'
    | 'focusEventId'
    | 'focusMomentId'
    | 'timezone'
    | 'fetchEventsByIds'
    | 'fetchRelatedEventsForFocus'
    | 'fetchEventsForMoment'
    | 'cursorForEvent'
  >): Promise<TimelinePageData> {
  const scannedEvents = new Map<string, TimelineEvent>();
  let scanCursor = cursor ?? null;
  let nextCursor: string | null = null;
  let moments: TimelineMoment[] = [];
  let scannedPageCount = 0;
  let maxScanPagesReached = false;
  let boundaryCursorAdjusted = false;

  for (let scanned = 0; scanned < maxScanPages; scanned++) {
    const page = await fetchPage({ cursor: scanCursor, limit: pageSize });
    scannedPageCount = scanned + 1;
    for (const event of page.items) scannedEvents.set(event.id, event);
    moments = buildTimelineMoments([...scannedEvents.values()], new Map(), { timezone });
    nextCursor = page.nextCursor;
    if (!nextCursor) break;
    if (moments.length > limit) {
      const firstUnreturnedMoment = moments[limit];
      boundaryCursorAdjusted = Boolean(firstUnreturnedMoment);
      nextCursor = firstUnreturnedMoment
        ? cursorBeforeMoment(firstUnreturnedMoment, [...scannedEvents.values()], cursorForEvent)
        : scanCursor;
      break;
    }
    if (scanned + 1 >= maxScanPages) maxScanPagesReached = true;
    scanCursor = nextCursor;
  }

  const selectedEvents = new Map<string, TimelineEvent>();
  for (const moment of moments.slice(0, limit)) {
    for (const event of moment.rawEvents) selectedEvents.set(event.id, event);
  }
  const focusedEvents = await focusedMomentEvents({
    selectedEvents: Array.from(selectedEvents.values()),
    focusEventId: focusEventId ?? null,
    timezone,
    fetchEventsByIds,
    fetchRelatedEventsForFocus,
  });
  for (const event of focusedEvents) selectedEvents.set(event.id, event);
  const focusedMomentIdEvents = await focusedMomentIdTargetEvents({
    selectedEvents: Array.from(selectedEvents.values()),
    focusMomentId: focusMomentId ?? null,
    timezone,
    fetchEventsForMoment,
  });
  for (const event of focusedMomentIdEvents) selectedEvents.set(event.id, event);
  const items = Array.from(selectedEvents.values()).sort(
    (a: TimelineEvent, b: TimelineEvent) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  return {
    items,
    nextCursor,
    impactItems: await hydrateImpact(items.map((event) => event.id)),
    diagnostics: {
      mode: 'moments',
      scannedPageCount,
      scannedRawEventCount: scannedEvents.size,
      returnedRawEventCount: items.length,
      returnedMomentCount: Math.min(moments.length, limit),
      maxScanPagesReached,
      boundaryCursorAdjusted,
      providerMetadata: summarizeProviderMetadataDiagnostics([...scannedEvents.values()], timezone),
    },
  };
}

function summarizeProviderMetadataDiagnostics(
  events: TimelineEvent[],
  timezone?: string,
): TimelineProviderMetadataDiagnostics {
  const diagnostics = timelineMomentDiagnostics(events, { timezone });
  const byProvider: TimelineProviderMetadataDiagnostics['byProvider'] = {};
  for (const diagnostic of diagnostics) {
    const provider = diagnostic.provider ?? diagnostic.source;
    const entry = byProvider[provider] ?? { count: 0, missingFields: {} };
    entry.count += 1;
    for (const field of diagnostic.missingFields) {
      entry.missingFields[field] = (entry.missingFields[field] ?? 0) + 1;
    }
    byProvider[provider] = entry;
  }
  return {
    total: diagnostics.length,
    affectedEventCount: new Set(diagnostics.map((diagnostic) => diagnostic.eventId)).size,
    byProvider,
    diagnostics,
  };
}

function timelineCursorForEvent(event: TimelineEvent): string {
  return encodeCursor({ at: new Date(event.occurredAt).toISOString(), id: event.id });
}

function cursorBeforeMoment(
  moment: TimelineMoment,
  events: TimelineEvent[],
  cursorForEvent: (event: TimelineEvent) => string,
): string | null {
  const lead = moment.rawEvents[0];
  if (!lead) return null;
  const orderedEvents = [...events].sort(compareEventsDescending);
  const leadIndex = orderedEvents.findIndex((event) => event.id === lead.id);
  const previous = leadIndex > 0 ? orderedEvents[leadIndex - 1] : null;
  return previous ? cursorForEvent(previous) : null;
}

function compareEventsDescending(a: TimelineEvent, b: TimelineEvent): number {
  const timeDelta = new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
  if (timeDelta !== 0) return timeDelta;
  return b.id.localeCompare(a.id);
}

async function focusedMomentEvents({
  selectedEvents,
  focusEventId,
  timezone,
  fetchEventsByIds,
  fetchRelatedEventsForFocus,
}: {
  selectedEvents: TimelineEvent[];
  focusEventId: string | null;
  timezone: string | undefined;
  fetchEventsByIds: CollectTimelinePageOptions['fetchEventsByIds'];
  fetchRelatedEventsForFocus: CollectTimelinePageOptions['fetchRelatedEventsForFocus'];
}): Promise<TimelineEvent[]> {
  if (!focusEventId) return [];
  const selectedFocus = selectedEvents.find((event) => event.id === focusEventId);
  const focus = selectedFocus ?? (await fetchEventsByIds?.([focusEventId]))?.[0] ?? null;
  if (!focus) return [];
  if (!fetchRelatedEventsForFocus) return selectedFocus ? [] : [focus];

  const related = await fetchRelatedEventsForFocus(focus);
  const candidateEvents = dedupeEvents([focus, ...selectedEvents, ...related]);
  const targetGroupKey = timelineGroupKey(focus, timezone);
  const focusedMoment = buildTimelineMoments(candidateEvents, new Map(), { timezone }).find(
    (moment) =>
      moment.rawEvents.some((event) => event.id === focus.id) &&
      (moment.grouping.key === targetGroupKey ||
        moment.rawEvents.some((event) => timelineGroupKey(event, timezone) === targetGroupKey)),
  );
  return focusedMoment?.rawEvents ?? (selectedFocus ? [] : [focus]);
}

async function focusedMomentIdTargetEvents({
  selectedEvents,
  focusMomentId,
  timezone,
  fetchEventsForMoment,
}: {
  selectedEvents: TimelineEvent[];
  focusMomentId: string | null;
  timezone: string | undefined;
  fetchEventsForMoment: CollectTimelinePageOptions['fetchEventsForMoment'];
}): Promise<TimelineEvent[]> {
  if (!focusMomentId) return [];
  const selectedMoment = buildTimelineMoments(selectedEvents, new Map(), { timezone }).find(
    (moment) => moment.id === focusMomentId,
  );
  if (selectedMoment) return selectedMoment.rawEvents;
  if (!fetchEventsForMoment) return [];

  const candidateEvents = await fetchEventsForMoment(focusMomentId);
  const targetMoment = buildTimelineMoments(candidateEvents, new Map(), { timezone }).find(
    (moment) => moment.id === focusMomentId,
  );
  return targetMoment?.rawEvents ?? [];
}

function dedupeEvents(events: TimelineEvent[]): TimelineEvent[] {
  return Array.from(new Map(events.map((event) => [event.id, event])).values());
}

async function includeFocusedEvents(
  items: TimelineEvent[],
  focusEventId: string | null,
  fetchEventsByIds: CollectTimelinePageOptions['fetchEventsByIds'],
): Promise<TimelineEvent[]> {
  if (!focusEventId || items.some((event) => event.id === focusEventId) || !fetchEventsByIds) {
    return items;
  }
  const focused = await fetchEventsByIds([focusEventId]);
  if (focused.length === 0) return items;
  return [...focused, ...items].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
}
