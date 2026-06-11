import type { ImpactItem, ImpactKind, TimelineMoment } from '@/lib/timeline-moments';
import type { TimelineEvent } from '@/lib/use-paginated-queries';

import { buildTimelineMoments, filterTimelineMomentsByImpact } from '@/lib/timeline-moments';

interface TimelinePageData {
  items: TimelineEvent[];
  nextCursor: string | null;
  impactItems: Record<string, ImpactItem[]>;
}

interface TimelinePageWindow {
  items: TimelineEvent[];
  nextCursor: string | null;
}

interface CollectTimelinePageOptions {
  cursor?: string | null;
  focusEventId?: string | null;
  impact?: ImpactKind | null;
  limit?: number;
  maxScanPages?: number;
  pageSize?: number;
  fetchPage: (input: { cursor: string | null; limit: number }) => Promise<TimelinePageWindow>;
  fetchEventsByIds?: (eventIds: string[]) => Promise<TimelineEvent[]>;
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

export async function collectTimelinePage({
  cursor = null,
  focusEventId = null,
  impact = null,
  limit = DEFAULT_PAGE_SIZE,
  maxScanPages = DEFAULT_MAX_SCAN_PAGES,
  pageSize = DEFAULT_PAGE_SIZE,
  fetchPage,
  fetchEventsByIds,
  hydrateImpact,
}: CollectTimelinePageOptions): Promise<TimelinePageData> {
  if (!impact) {
    const page = await fetchPage({ cursor, limit });
    const items = await includeFocusedEvents(page.items, focusEventId, fetchEventsByIds);
    return {
      items,
      nextCursor: page.nextCursor,
      impactItems: await hydrateImpact(items.map((event) => event.id)),
    };
  }

  const scannedEvents = new Map<string, TimelineEvent>();
  const impactItems: Record<string, ImpactItem[]> = {};
  let scanCursor = cursor;
  let nextCursor: string | null = null;
  let matchingMoments: TimelineMoment[] = [];

  for (let scanned = 0; scanned < maxScanPages; scanned++) {
    const page = await fetchPage({ cursor: scanCursor, limit: pageSize });
    const pageImpactItems = await hydrateImpact(page.items.map((event) => event.id));
    Object.assign(impactItems, pageImpactItems);
    for (const event of page.items) scannedEvents.set(event.id, event);

    matchingMoments = filterTimelineMomentsByImpact(
      buildTimelineMoments([...scannedEvents.values()], new Map(), {
        impactItemsByEventId: impactItems,
      }),
      impact,
    );

    nextCursor = page.nextCursor;
    if (!nextCursor || matchingMoments.length >= limit) break;
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

  return {
    items: Array.from(collected.values()).sort(
      (a: TimelineEvent, b: TimelineEvent) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    ),
    nextCursor,
    impactItems,
  };
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
