import type { TimelineCapturedFile } from '@/lib/timeline-captured-files';
import type { EventSource, SearchEventArtifactCluster } from '@timeline/shared/team-scope';
import type {
  ImpactItem,
  TimelineGroupingVersion,
  TimelineMomentDiagnostic,
  TimelineMomentsPageVersion,
  TimelineMomentDto,
} from '@timeline/shared/timeline-moments';

export type TimelineArtifactCluster = SearchEventArtifactCluster;
export type WebTimelineMomentDto = TimelineMomentDto<TimelineEvent, TimelineArtifactCluster>;

export interface TimelinePage {
  version?: TimelineMomentsPageVersion;
  groupingVersion?: TimelineGroupingVersion;
  mode?: 'moments' | 'events';
  moments?: WebTimelineMomentDto[];
  pinnedMomentIds?: string[];
  rawEventsById?: Record<string, TimelineEvent>;
  diagnostics?: {
    mode: 'moments' | 'events';
    scannedPageCount: number;
    scannedRawEventCount: number;
    returnedRawEventCount: number;
    returnedMomentCount: number | null;
    maxScanPagesReached: boolean;
    boundaryCursorAdjusted: boolean;
    providerMetadata: {
      total: number;
      affectedEventCount: number;
      byProvider: Record<string, { count: number; missingFields: Record<string, number> }>;
      diagnostics: TimelineMomentDiagnostic[];
    };
  };
  items: TimelineEvent[];
  nextCursor: string | null;
  authors: Record<string, { id: string; name: string | null; email: string }>;
  audioUrls: Record<string, string>;
  impactItems: Record<string, ImpactItem[]>;
  artifactClusters: Record<string, TimelineArtifactCluster>;
  capturedFiles: Record<string, TimelineCapturedFile[]>;
}

export interface TimelineEvent {
  id: string;
  teamId: string;
  authorUserId: string | null;
  source: EventSource;
  contentText: string | null;
  contentAudioUrl: string | null;
  occurredAt: string;
  createdAt: string;
  visibility: 'private' | 'team' | 'specific_users';
  visibilityUserIds: string[] | null;
  visibilityOwnerUserId: string | null;
  sourceMetadata: unknown;
}
