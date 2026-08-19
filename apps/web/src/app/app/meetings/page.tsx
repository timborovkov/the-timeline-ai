import { users } from '@timeline/db';
import { pageWindow } from '@timeline/shared/pagination';
import { withTeam } from '@timeline/shared/team-scope';
import { inArray } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { SavedMeetingRow } from '@timeline/shared/meetings';
import type { Metadata } from 'next';

import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { CollectionToolbar } from '@/components/collections/collection-toolbar';
import { EmptyAction } from '@/components/empty-action';
import {
  ArchiveSavedMeetingButton,
  EditSavedMeetingForm,
  JoinSavedMeetingButton,
  SavedMeetingForm,
  ScheduleMeetingBotForm,
} from '@/components/meeting-forms';
import { MeetingCapturesList } from '@/components/meetings/meeting-captures-list';
import { PageHeader } from '@/components/page-header';
import { PinOverflowMenu } from '@/components/pins/pin-overflow-menu';
import { SectionHeading } from '@/components/section-heading';
import { Button } from '@/components/ui/button';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { NativeSelect } from '@/components/ui/native-select';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { formatCollectionCount } from '@/lib/collection-count';
import { MEETINGS_PAGE_SIZE } from '@/lib/collection-page-sizes';
import { db } from '@/lib/db';
import { displayMeetingLabel, displayMemberLabel, displaySourceLabel } from '@/lib/display-labels';
import { CAPTURE_FILTERS, type CaptureFilter } from '@/lib/meeting-capture-filters';

export const metadata: Metadata = {
  title: 'Meetings',
  description: 'Schedule and review meeting notes.',
};

type MeetingTab = 'captures' | 'saved';
interface MemberOption {
  id: string;
  label: string;
}

function queryValue(value: string | undefined): string {
  return value?.trim().slice(0, 120) ?? '';
}

function captureFilter(value: string | undefined): CaptureFilter {
  return CAPTURE_FILTERS.some((filter) => filter.value === value)
    ? (value as CaptureFilter)
    : 'all';
}

function meetingHref({
  tab,
  query,
  filter,
}: {
  tab: MeetingTab;
  query?: string;
  filter?: CaptureFilter;
}): string {
  const params = new URLSearchParams();
  if (tab === 'saved') params.set('tab', 'saved');
  if (query) params.set('q', query);
  if (tab === 'captures' && filter && filter !== 'all') params.set('status', filter);
  const search = params.toString();
  return search ? `/app/meetings?${search}` : '/app/meetings';
}

function meetingTabLinkClass(active: boolean): string {
  return `rounded-t-sm px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ${
    active
      ? 'border-b-2 border-signal font-medium text-fg'
      : 'text-muted-foreground hover:bg-surface-2 hover:text-fg'
  }`;
}

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; q?: string; status?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();

  const params = (await searchParams) ?? {};
  const tab = params.tab === 'saved' ? 'saved' : 'captures';
  const query = queryValue(params.q);
  const filter = tab === 'captures' ? captureFilter(params.status) : 'all';

  const [list, savedMeetings, usedMinutes, settings, calendarSettings, defaultRow, members] =
    await Promise.all([
      tab === 'captures'
        ? scope.meetings.listMeetings({ limit: MEETINGS_PAGE_SIZE + 1, cursor: null })
        : Promise.resolve([]),
      tab === 'saved' ? scope.meetings.listSavedMeetings() : Promise.resolve([]),
      scope.meetings.getCurrentMonthMinutes(),
      scope.meetings.getMeetingSettings(),
      scope.calendar.getCalendarSettings(),
      scope.timeline.resolveVisibilityDefault('meeting'),
      scope.timeline.listMembers(),
    ]);
  const memberIds = members.map((m) => m.userId);
  const capturePage = pageWindow(list, MEETINGS_PAGE_SIZE, (meeting) => ({
    at: meeting.createdAt.toISOString(),
    id: meeting.id,
  }));
  const pinStatePromise = scope.pins.isPinnedMany([
    ...capturePage.items.map((meeting) => ({ kind: 'meeting' as const, key: meeting.id })),
    ...savedMeetings.map((meeting) => ({ kind: 'saved_meeting' as const, key: meeting.id })),
  ]);
  const memberUsersPromise =
    memberIds.length > 0
      ? db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, memberIds))
      : Promise.resolve([]);
  const [pinState, memberUsers] = await Promise.all([pinStatePromise, memberUsersPromise]);
  const memberUserMap = new Map(memberUsers.map((u) => [u.id, u] as const));
  const memberOptions = members.map((m) => {
    const u = memberUserMap.get(m.userId);
    return { id: m.userId, label: displayMemberLabel(u) };
  });
  const cap = settings.meetingMinutesCap;
  const normalizedQuery = query.toLocaleLowerCase();
  const filteredSavedMeetings = savedMeetings.filter((meeting) => {
    if (!normalizedQuery) return true;
    return [
      displayMeetingLabel(meeting),
      meeting.description ?? '',
      displaySourceLabel(meeting.platform),
      ...meeting.aliases,
    ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  });
  const hasCaptureFilters = tab === 'captures' && (Boolean(query) || filter !== 'all');
  const hasSavedSearch = Boolean(query);
  const clearCurrentViewHref = meetingHref({ tab });

  return (
    <div className="space-y-4">
      <PageHeader
        variant="collection"
        title="Meetings"
        subtitle="Invite the silent notetaker or manage meeting links for automatic capture."
        metadata={[
          { label: 'This month', value: `${String(usedMinutes)} minutes`, mono: true },
          ...(cap !== null ? [{ label: 'Cap', value: `${String(cap)} minutes`, mono: true }] : []),
        ]}
      />

      <MeetingsViewNavigation tab={tab} />

      {tab === 'captures' ? (
        <details className="border-y border-border py-1.5">
          <summary className="cursor-pointer text-sm text-fg-muted hover:text-fg">
            Invite notetaker
          </summary>
          <div id="invite-notetaker" className="scroll-mt-24 pt-3">
            <ScheduleMeetingBotForm
              defaultVisibility={defaultRow.visibility}
              defaultVisibilityUserIds={defaultRow.visibilityUserIds}
              members={memberOptions}
            />
          </div>
        </details>
      ) : (
        <details className="border-y border-border py-1.5">
          <summary className="cursor-pointer text-sm text-fg-muted hover:text-fg">
            Save a meeting
          </summary>
          <div id="save-meeting" className="scroll-mt-24 pt-3">
            <SavedMeetingForm
              defaultVisibility={defaultRow.visibility}
              defaultVisibilityUserIds={defaultRow.visibilityUserIds}
              defaultTimezone={calendarSettings.defaultTimezone}
              members={memberOptions}
            />
          </div>
        </details>
      )}

      <MeetingSearchControls
        clearHref={clearCurrentViewHref}
        filter={filter}
        hasActiveFilters={tab === 'captures' ? hasCaptureFilters : hasSavedSearch}
        query={query}
        tab={tab}
      />

      {tab === 'saved' ? (
        <SavedMeetingsSection
          clearHref={clearCurrentViewHref}
          hasSearch={hasSavedSearch}
          meetings={filteredSavedMeetings}
          members={memberOptions}
          pinState={pinState}
          timezone={calendarSettings.defaultTimezone}
          totalCount={savedMeetings.length}
        />
      ) : (
        <MeetingCapturesSection
          clearHref={clearCurrentViewHref}
          filter={filter}
          hasActiveFilters={hasCaptureFilters}
          meetings={capturePage.items.map((meeting) => ({
            id: meeting.id,
            title: meeting.title,
            platform: meeting.platform,
            status: meeting.status,
            createdAt: meeting.createdAt.toISOString(),
            scheduledStartAt: meeting.scheduledStartAt?.toISOString() ?? null,
            pinned: pinState[`meeting:${meeting.id}`] ?? false,
          }))}
          nextCursor={capturePage.nextCursor}
          query={query}
        />
      )}
    </div>
  );
}

function MeetingsViewNavigation({ tab }: { tab: MeetingTab }) {
  return (
    <nav aria-label="Meeting views" className="flex gap-1 border-b border-border">
      <Link
        href="/app/meetings"
        aria-current={tab === 'captures' ? 'page' : undefined}
        className={meetingTabLinkClass(tab === 'captures')}
      >
        Captures
      </Link>
      <Link
        href="/app/meetings?tab=saved"
        aria-current={tab === 'saved' ? 'page' : undefined}
        className={meetingTabLinkClass(tab === 'saved')}
      >
        Saved
      </Link>
    </nav>
  );
}

function MeetingSearchControls({
  clearHref,
  filter,
  hasActiveFilters,
  query,
  tab,
}: {
  clearHref: string;
  filter: CaptureFilter;
  hasActiveFilters: boolean;
  query: string;
  tab: MeetingTab;
}) {
  return (
    <form action="/app/meetings" role="search">
      <input name="tab" type="hidden" value={tab === 'saved' ? 'saved' : ''} />
      <CollectionToolbar
        activeFilters={[
          ...(query
            ? [{ key: 'query', label: 'Search', value: query, href: meetingHref({ tab, filter }) }]
            : []),
          ...(tab === 'captures' && filter !== 'all'
            ? [
                {
                  key: 'status',
                  label: 'Status',
                  value: CAPTURE_FILTERS.find((option) => option.value === filter)?.label ?? filter,
                  href: meetingHref({ tab, query }),
                },
              ]
            : []),
        ]}
      >
        <CollectionToolbar.Search>
          <label className="block min-w-0">
            <span className="sr-only">
              {tab === 'saved' ? 'Search saved meetings' : 'Search captures'}
            </span>
            <input
              id="meeting-search"
              name="q"
              type="search"
              defaultValue={query}
              placeholder={
                tab === 'saved' ? 'Title, alias, or platform' : 'Title, platform, or status'
              }
              className="h-9 w-full rounded-sm border-0 bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40"
            />
          </label>
        </CollectionToolbar.Search>
        <CollectionToolbar.Filters>
          {tab === 'captures' ? (
            <label className="space-y-1">
              <span className="block text-[11px] text-fg-dim">Capture status</span>
              <NativeSelect id="capture-status" name="status" defaultValue={filter}>
                {CAPTURE_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
          ) : null}
        </CollectionToolbar.Filters>
        <CollectionToolbar.Actions>
          <div className="flex items-center gap-1">
            <Button type="submit" size="sm" variant="outline">
              Apply
            </Button>
            {hasActiveFilters ? (
              <Button asChild size="sm" variant="ghost">
                <Link href={clearHref}>Clear filters</Link>
              </Button>
            ) : null}
          </div>
        </CollectionToolbar.Actions>
      </CollectionToolbar>
    </form>
  );
}

function SavedMeetingsSection({
  clearHref,
  hasSearch,
  meetings,
  members,
  pinState,
  timezone,
  totalCount,
}: {
  clearHref: string;
  hasSearch: boolean;
  meetings: SavedMeetingRow[];
  members: MemberOption[];
  pinState: Record<string, boolean>;
  timezone: string;
  totalCount: number;
}) {
  return (
    <section aria-labelledby="saved-meetings-heading" className="space-y-3">
      <SectionHeading id="saved-meetings-heading">Saved meetings</SectionHeading>
      {hasSearch ? (
        <p aria-live="polite" className="text-xs tabular-nums text-fg-muted">
          {formatCollectionCount({
            matching: meetings.length,
            total: totalCount,
            filtered: true,
          })}
        </p>
      ) : null}
      {meetings.length === 0 ? (
        <EmptyAction
          title={hasSearch ? 'No saved meetings match your search' : 'No saved meeting links yet'}
          body={
            hasSearch
              ? 'Try a different search or clear it to see every saved meeting.'
              : 'Save a meeting link to keep its details, permissions, and recurring schedule together.'
          }
          href={hasSearch ? clearHref : '#save-meeting'}
          action={hasSearch ? 'Clear filters' : 'Save a meeting'}
        />
      ) : (
        <ul aria-label="Saved meetings">
          {meetings.map((saved) => (
            <li
              id={`saved-meeting-${saved.id}`}
              key={saved.id}
              className="scroll-mt-24"
              style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 64px' }}
            >
              <CollectionRow>
                <CollectionRow.Title>{displayMeetingLabel(saved)}</CollectionRow.Title>
                <CollectionRow.Context>
                  {saved.description ??
                    (saved.aliases.length ? saved.aliases.join(', ') : 'No aliases')}
                </CollectionRow.Context>
                <CollectionRow.Metadata>
                  <>
                    <span>{displaySourceLabel(saved.platform)}</span>
                    <CollectionStatus
                      value={saved.autoJoinEnabled ? 'active' : 'manual'}
                      label={saved.autoJoinEnabled ? 'Auto-join' : 'Manual join'}
                    />
                  </>
                </CollectionRow.Metadata>
                <CollectionRow.Actions>
                  <ItemActionGroup label={`Actions for ${displayMeetingLabel(saved)}`}>
                    <JoinSavedMeetingButton query={saved.aliases[0] ?? saved.title} />
                    <PinOverflowMenu
                      target={{ kind: 'saved_meeting', key: saved.id }}
                      title={displayMeetingLabel(saved)}
                      initialPinned={pinState[`saved_meeting:${saved.id}`] ?? false}
                    />
                    <ArchiveSavedMeetingButton savedMeetingId={saved.id} />
                  </ItemActionGroup>
                </CollectionRow.Actions>
              </CollectionRow>
              <details className="px-3 pb-3">
                <summary className="cursor-pointer py-1.5 text-xs text-fg-dim hover:text-fg">
                  Edit details
                </summary>
                <div className="pt-2">
                  <EditSavedMeetingForm
                    saved={saved}
                    defaultTimezone={timezone}
                    members={members}
                  />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MeetingCapturesSection({
  clearHref,
  filter,
  hasActiveFilters,
  meetings,
  nextCursor,
  query,
}: {
  clearHref: string;
  filter: CaptureFilter;
  hasActiveFilters: boolean;
  meetings: {
    id: string;
    title: string | null;
    platform: string;
    status: string;
    createdAt: string;
    scheduledStartAt: string | null;
    pinned: boolean;
  }[];
  nextCursor: string | null;
  query: string;
}) {
  return (
    <section aria-labelledby="meeting-captures-heading" className="space-y-3">
      <SectionHeading id="meeting-captures-heading">Recent captures</SectionHeading>
      <MeetingCapturesList
        clearHref={clearHref}
        filter={filter}
        hasActiveFilters={hasActiveFilters}
        initialMeetings={meetings}
        nextCursor={nextCursor}
        query={query}
        tab="captures"
      />
    </section>
  );
}
