import type { TimelineMoment as SharedTimelineMoment } from '@timeline/shared/timeline-moments';

import type { TimelineArtifactCluster, TimelineEvent } from '@/lib/timeline-types';

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
export type { WebTimelineMomentDto } from '@/lib/timeline-types';
