'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';

import { loadMeetingsPageAction } from '@/app/actions/collection-pages';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { InfiniteScroll } from '@/components/collections/infinite-scroll';
import { VirtualList } from '@/components/collections/virtual-list';
import { EmptyAction } from '@/components/empty-action';
import { SkipScheduledMeetingButton } from '@/components/meeting-forms';
import { PinOverflowMenu } from '@/components/pins/pin-overflow-menu';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { formatCollectionCount } from '@/lib/collection-count';
import { formatDisplayDateTime } from '@/lib/display-dates';
import { displayMeetingLabel, displaySourceLabel } from '@/lib/display-labels';
import { type CaptureFilter } from '@/lib/meeting-capture-filters';

export interface MeetingCaptureItem {
  id: string;
  title: string | null;
  platform: string;
  status: string;
  createdAt: string;
  scheduledStartAt: string | null;
  pinned: boolean;
}

function matchesCaptureFilter(status: string, filter: CaptureFilter): boolean {
  switch (filter) {
    case 'scheduled':
      return status === 'scheduled';
    case 'in_progress':
      return ['pending', 'joining', 'active', 'processing'].includes(status);
    case 'completed':
      return ['completed', 'completed_partial'].includes(status);
    case 'attention':
      return status === 'failed';
    case 'ended':
      return ['skipped', 'no_show', 'cancelled'].includes(status);
    default:
      return true;
  }
}

export function MeetingCapturesList({
  initialMeetings,
  nextCursor,
  query,
  filter,
  hasActiveFilters,
  timezone,
  tab,
  clearHref,
}: {
  initialMeetings: MeetingCaptureItem[];
  nextCursor: string | null;
  query: string;
  filter: CaptureFilter;
  hasActiveFilters: boolean;
  timezone: string;
  tab: 'captures' | 'saved';
  clearHref: string;
}) {
  const [extraMeetings, setExtraMeetings] = useState<MeetingCaptureItem[]>([]);
  const [extraCursor, setExtraCursor] = useState<string | null>(null);
  const [paged, setPaged] = useState(false);
  const meetings = useMemo(
    () => [...initialMeetings, ...extraMeetings],
    [extraMeetings, initialMeetings],
  );
  const cursor = paged ? extraCursor : nextCursor;
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const normalizedQuery = query.toLocaleLowerCase();
  const visibleMeetings = useMemo(
    () =>
      meetings.filter((meeting) => {
        const matchesQuery =
          !normalizedQuery ||
          [displayMeetingLabel(meeting), displaySourceLabel(meeting.platform), meeting.status].some(
            (value) => value.toLocaleLowerCase().includes(normalizedQuery),
          );
        return matchesQuery && matchesCaptureFilter(meeting.status, filter);
      }),
    [filter, meetings, normalizedQuery],
  );

  function loadMore(): void {
    if (!cursor || loading) return;
    startLoading(async () => {
      const page = await loadMeetingsPageAction({ cursor });
      if (page.error) {
        setError(page.error);
        return;
      }
      setError(null);
      setPaged(true);
      setExtraMeetings((current) => {
        const seen = new Set([...initialMeetings, ...current].map((meeting) => meeting.id));
        return [...current, ...page.meetings.filter((meeting) => !seen.has(meeting.id))];
      });
      setExtraCursor(page.nextCursor);
    });
  }

  const countLabel =
    hasActiveFilters && cursor === null
      ? formatCollectionCount({
          matching: visibleMeetings.length,
          total: meetings.length,
          filtered: true,
        })
      : null;

  if (visibleMeetings.length === 0 && cursor === null && !loading) {
    return (
      <div className="space-y-3">
        {countLabel ? <p className="text-xs tabular-nums text-fg-muted">{countLabel}</p> : null}
        <EmptyAction
          title={hasActiveFilters ? 'No captures match these filters' : 'No meeting captures yet'}
          body={
            hasActiveFilters
              ? 'Try a different search or clear the filters to see every capture.'
              : 'Invite the notetaker for a meeting to capture its transcript and follow-up context here.'
          }
          href={
            hasActiveFilters
              ? clearHref
              : tab === 'captures'
                ? '#invite-notetaker'
                : '/app/meetings'
          }
          action={hasActiveFilters ? 'Clear filters' : 'Invite notetaker'}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {countLabel ? (
        <p aria-live="polite" className="text-xs tabular-nums text-fg-muted">
          {countLabel}
        </p>
      ) : null}
      <VirtualList
        items={visibleMeetings}
        getItemKey={(meeting) => meeting.id}
        estimateSize={52}
        ariaLabel="Meeting captures"
        renderItem={(meeting) => (
          <CollectionRow
            title={
              <Link
                href={`/app/meetings/${meeting.id}`}
                className="block truncate rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              >
                {displayMeetingLabel(meeting)}
              </Link>
            }
            context={displaySourceLabel(meeting.platform)}
            metadata={
              <>
                <CollectionStatus value={meeting.status} />
                <time
                  className="font-mono tabular-nums"
                  dateTime={meeting.scheduledStartAt ?? meeting.createdAt}
                >
                  {formatDisplayDateTime(meeting.scheduledStartAt ?? meeting.createdAt, {
                    timezone,
                  })}
                </time>
              </>
            }
            actions={
              <ItemActionGroup label={`Actions for ${displayMeetingLabel(meeting)}`}>
                {meeting.status === 'scheduled' ? (
                  <SkipScheduledMeetingButton meetingId={meeting.id} />
                ) : null}
                <PinOverflowMenu
                  target={{ kind: 'meeting', key: meeting.id }}
                  title={displayMeetingLabel(meeting)}
                  initialPinned={meeting.pinned}
                />
              </ItemActionGroup>
            }
          />
        )}
      />
      <InfiniteScroll
        hasMore={cursor !== null}
        loading={loading}
        error={error}
        onLoadMore={loadMore}
        boundLabel="No more matching meetings"
        hideBound={visibleMeetings.length === 0}
      />
    </div>
  );
}
