import type {
  TimelineMomentPresentationCacheStats,
  TimelinePageDiagnostics,
} from '@/lib/timeline-page';
import type { ProductEventPayloads } from '@timeline/shared/analytics/posthog-node';

import { trackProductEventBestEffort } from '@/lib/analytics';

export interface TimelineObservabilityInput {
  teamId: string;
  userId: string;
  surface: 'page' | 'api';
  diagnostics: TimelinePageDiagnostics;
  presentationCacheStats: TimelineMomentPresentationCacheStats;
  filters: {
    source?: string | null;
    origin?: string | null;
    impact?: string | null;
    author?: string | null;
    from?: string | null;
    to?: string | null;
    event?: string | null;
    moment?: string | null;
    cursor?: string | null;
  };
}

export type TimelineMomentsViewedPayload = ProductEventPayloads['timeline_moments_viewed'];

function rawToMomentRatio(diagnostics: TimelinePageDiagnostics): number | null {
  const returnedMomentCount = diagnostics.returnedMomentCount;
  if (!returnedMomentCount || returnedMomentCount <= 0) return null;
  return Number((diagnostics.returnedRawEventCount / returnedMomentCount).toFixed(2));
}

export function buildTimelineMomentsViewedPayload(
  input: TimelineObservabilityInput,
): TimelineMomentsViewedPayload {
  const { diagnostics, filters, presentationCacheStats } = input;
  return {
    teamId: input.teamId,
    userId: input.userId,
    surface: input.surface,
    mode: diagnostics.mode,
    hasSourceFilter: Boolean(filters.source ?? filters.origin),
    hasImpactFilter: Boolean(filters.impact),
    hasAuthorFilter: Boolean(filters.author),
    hasDateFilter: Boolean(filters.from ?? filters.to),
    hasFocusedEvent: Boolean(filters.event),
    hasFocusedMoment: Boolean(filters.moment),
    isCursorPage: Boolean(filters.cursor),
    scannedPageCount: diagnostics.scannedPageCount,
    scannedRawEventCount: diagnostics.scannedRawEventCount,
    returnedRawEventCount: diagnostics.returnedRawEventCount,
    returnedMomentCount: diagnostics.returnedMomentCount,
    rawToMomentRatio: rawToMomentRatio(diagnostics),
    boundaryOverfetchCount: diagnostics.boundaryCursorAdjusted ? 1 : 0,
    scanCapHitCount: diagnostics.maxScanPagesReached ? 1 : 0,
    missingGroupingMetadataCount: diagnostics.providerMetadata.total,
    missingGroupingMetadataAffectedEventCount: diagnostics.providerMetadata.affectedEventCount,
    missingGroupingMetadataByProvider: Object.fromEntries(
      Object.entries(diagnostics.providerMetadata.byProvider).map(([provider, value]) => [
        provider,
        value.count,
      ]),
    ),
    aiCacheHitCount: presentationCacheStats.hitCount,
    aiCacheMissCount: presentationCacheStats.missCount,
    aiCacheStaleCount: presentationCacheStats.staleCount,
    aiCacheEligibleMissCount: presentationCacheStats.eligibleMissCount,
    aiCacheQueuedMissingCount: presentationCacheStats.queuedMissingCount,
    visibilityCachePartitionCount: presentationCacheStats.visibilityPartitionCount,
  };
}

export function trackTimelineMomentsViewed(input: TimelineObservabilityInput): void {
  trackProductEventBestEffort(
    input.userId,
    'timeline_moments_viewed',
    buildTimelineMomentsViewedPayload(input),
  );
}
