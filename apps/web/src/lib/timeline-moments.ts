import type { TimelineArtifactCluster, TimelineEvent } from '@/lib/use-paginated-queries';
import type {
  TimelineMoment as SharedTimelineMoment,
  TimelineMomentDto as SharedTimelineMomentDto,
} from '@timeline/shared/timeline-moments';

export {
  actorLabelsByTelegramUserId,
  buildTimelineMoments,
  displayMeta,
  filterTimelineMomentsByImpact,
  formatDateSection,
  formatTimelineAttachmentText,
  meetingDetailHrefForMoment,
  telegramUsernameLabel,
  timelineAttachmentSummaryFromMetadata,
  timelineGroupKey,
  timelineMomentDiagnostics,
  timelineMomentLookupPlan,
  toTimelineMomentDto,
  type ImpactItem,
  type ImpactKind,
  type TimelineMomentDiagnostic,
  type TimelineAuthor,
  type TimelineGroupingVersion,
  type TimelineImpactFilter,
  type TimelineMomentsPageVersion,
} from '@timeline/shared/timeline-moments';

export type TimelineMoment = SharedTimelineMoment<TimelineEvent, TimelineArtifactCluster>;
export type WebTimelineMomentDto = SharedTimelineMomentDto<TimelineEvent, TimelineArtifactCluster>;
