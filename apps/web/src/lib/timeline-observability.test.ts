import { describe, expect, it } from 'vitest';

import type {
  TimelineMomentPresentationCacheStats,
  TimelinePageDiagnostics,
} from '@/lib/timeline-page';

import { buildTimelineMomentsViewedPayload } from '@/lib/timeline-observability';

function diagnostics(overrides: Partial<TimelinePageDiagnostics> = {}): TimelinePageDiagnostics {
  return {
    mode: 'moments',
    scannedPageCount: 2,
    scannedRawEventCount: 60,
    returnedRawEventCount: 18,
    returnedMomentCount: 6,
    maxScanPagesReached: false,
    boundaryCursorAdjusted: true,
    providerMetadata: {
      total: 3,
      affectedEventCount: 2,
      byProvider: {
        github: { count: 2, missingFields: { external_object_id: 2 } },
        webhook: { count: 1, missingFields: { event_type: 1 } },
      },
      diagnostics: [],
    },
    ...overrides,
  };
}

function cacheStats(
  overrides: Partial<TimelineMomentPresentationCacheStats> = {},
): TimelineMomentPresentationCacheStats {
  return {
    hitCount: 4,
    missCount: 2,
    staleCount: 1,
    eligibleMissCount: 1,
    queuedMissingCount: 1,
    visibilityPartitionCount: 2,
    ...overrides,
  };
}

describe('timeline observability', () => {
  it('builds privacy-safe aggregate counters for dogfooding', () => {
    const payload = buildTimelineMomentsViewedPayload({
      teamId: 'team-1',
      userId: 'user-1',
      surface: 'api',
      diagnostics: diagnostics(),
      presentationCacheStats: cacheStats(),
      filters: {
        source: 'integration',
        impact: 'task',
        author: null,
        from: '2026-06-01',
        to: null,
        event: null,
        moment: 'moment:integration:github:pr:repo:123',
        cursor: 'cursor-2',
      },
    });

    expect(payload).toEqual({
      teamId: 'team-1',
      userId: 'user-1',
      surface: 'api',
      mode: 'moments',
      hasSourceFilter: true,
      hasImpactFilter: true,
      hasAuthorFilter: false,
      hasDateFilter: true,
      hasFocusedEvent: false,
      hasFocusedMoment: true,
      isCursorPage: true,
      scannedPageCount: 2,
      scannedRawEventCount: 60,
      returnedRawEventCount: 18,
      returnedMomentCount: 6,
      rawToMomentRatio: 3,
      boundaryOverfetchCount: 1,
      scanCapHitCount: 0,
      missingGroupingMetadataCount: 3,
      missingGroupingMetadataAffectedEventCount: 2,
      missingGroupingMetadataByProvider: { github: 2, webhook: 1 },
      aiCacheHitCount: 4,
      aiCacheMissCount: 2,
      aiCacheStaleCount: 1,
      aiCacheEligibleMissCount: 1,
      aiCacheQueuedMissingCount: 1,
      visibilityCachePartitionCount: 2,
    });
  });

  it('keeps source-event mode ratio empty because it has no moment denominator', () => {
    const payload = buildTimelineMomentsViewedPayload({
      teamId: 'team-1',
      userId: 'user-1',
      surface: 'page',
      diagnostics: diagnostics({ mode: 'events', returnedMomentCount: null }),
      presentationCacheStats: cacheStats({ visibilityPartitionCount: 0 }),
      filters: {},
    });

    expect(payload.mode).toBe('events');
    expect(payload.rawToMomentRatio).toBeNull();
    expect(payload.visibilityCachePartitionCount).toBe(0);
  });
});
