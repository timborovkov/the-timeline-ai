export interface EventListFilters {
  authorUserId?: string | string[];
  personObjectId?: string;
  senderHandle?: string;
  senderSource?: 'telegram' | 'slack' | 'email';
  /** Inclusive lower bound on `occurred_at`. */
  from?: Date;
  /** Exclusive upper bound on `occurred_at`. Callers wanting "include all of
   *  day X" should pass midnight UTC of day X+1. */
  to?: Date;
  /**
   * Narrow to one or more `event_source` values. Pushes the predicate into
   * SQL so `limit` bounds the matching rows (not the pre-filter window).
   */
  source?: string | string[];
  /**
   * Narrow timeline events to provider- or resource-level origins. Multiple
   * origins are ORed together, then combined with the other filters.
   */
  origins?: TimelineOriginFilter[];
  /**
   * Narrow integration events to one provider work item. Pushes
   * `source_metadata.external_object_id` into SQL so `limit` bounds the
   * matching rows.
   */
  externalObjectId?: string;
  limit?: number;
  cursor?: string | null;
}

export type TimelineOriginFilter =
  | { kind: 'provider'; provider: string }
  | { kind: 'monday_board'; boardId: string }
  | { kind: 'github_repo'; repo: string }
  | { kind: 'slack_channel'; channelId: string; workspaceId?: string }
  | { kind: 'telegram_chat'; chatId: string };

export interface TimelineSourceFacet {
  filter: TimelineOriginFilter;
  label: string;
  eventCount: number;
}

export interface ListIntegrationSearchEventIdsInput {
  provider?: 'google_drive' | 'linear' | 'github' | 'monday' | 'slack' | 'sentry';
  mondayBoardIds?: string[];
  mondayDocIds?: string[];
  limit: number;
}

export interface IntegrationSearchEventIds {
  eventIds: string[];
  truncated: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}
