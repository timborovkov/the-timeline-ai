import type { ImpactItem, ImpactKind } from '@/lib/timeline-moments';
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
  impact?: ImpactKind | null;
  limit?: number;
  maxScanPages?: number;
  pageSize?: number;
  fetchPage: (input: { cursor: string | null; limit: number }) => Promise<TimelinePageWindow>;
  hydrateImpact: (eventIds: string[]) => Promise<Record<string, ImpactItem[]>>;
}

const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_MAX_SCAN_PAGES = 10;

export async function collectTimelinePage({
  cursor = null,
  impact = null,
  limit = DEFAULT_PAGE_SIZE,
  maxScanPages = DEFAULT_MAX_SCAN_PAGES,
  pageSize = DEFAULT_PAGE_SIZE,
  fetchPage,
  hydrateImpact,
}: CollectTimelinePageOptions): Promise<TimelinePageData> {
  if (!impact) {
    const page = await fetchPage({ cursor, limit });
    return {
      ...page,
      impactItems: await hydrateImpact(page.items.map((event) => event.id)),
    };
  }

  const collected = new Map<string, TimelineEvent>();
  const impactItems: Record<string, ImpactItem[]> = {};
  let scanCursor = cursor;
  let nextCursor: string | null = null;

  for (let scanned = 0; scanned < maxScanPages; scanned++) {
    const page = await fetchPage({ cursor: scanCursor, limit: pageSize });
    const pageImpactItems = await hydrateImpact(page.items.map((event) => event.id));
    Object.assign(impactItems, pageImpactItems);

    const matchingMoments = filterTimelineMomentsByImpact(
      buildTimelineMoments(page.items, new Map(), { impactItemsByEventId: pageImpactItems }),
      impact,
    );
    for (const moment of matchingMoments) {
      for (const event of moment.rawEvents) {
        collected.set(event.id, event);
      }
    }

    nextCursor = page.nextCursor;
    if (!nextCursor || collected.size >= limit) break;
    scanCursor = nextCursor;
  }

  return {
    items: [...collected.values()].sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    ),
    nextCursor,
    impactItems,
  };
}
