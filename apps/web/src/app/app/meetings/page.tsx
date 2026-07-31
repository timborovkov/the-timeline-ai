import { users } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { inArray } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { MeetingRow, SavedMeetingRow } from '@timeline/shared/meetings';
import type { Metadata } from 'next';

import { EmptyAction } from '@/components/empty-action';
import {
  ArchiveSavedMeetingButton,
  EditSavedMeetingForm,
  JoinSavedMeetingButton,
  SavedMeetingForm,
  ScheduleMeetingBotForm,
  SkipScheduledMeetingButton,
} from '@/components/meeting-forms';
import { PageHeader } from '@/components/page-header';
import { PinOverflowMenu } from '@/components/pins/pin-overflow-menu';
import { SectionHeading } from '@/components/section-heading';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { formatDisplayDateTime } from '@/lib/display-dates';
import { displayMeetingLabel, displayMemberLabel, displaySourceLabel } from '@/lib/display-labels';

export const metadata: Metadata = {
  title: 'Meetings',
  description: 'Schedule and review meeting notes.',
};

const CAPTURE_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'ended', label: 'Not captured' },
] as const;

type CaptureFilter = (typeof CAPTURE_FILTERS)[number]['value'];
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
      scope.meetings.listMeetings({ limit: 50 }),
      tab === 'saved' ? scope.meetings.listSavedMeetings() : Promise.resolve([]),
      scope.meetings.getCurrentMonthMinutes(),
      scope.meetings.getMeetingSettings(),
      scope.calendar.getCalendarSettings(),
      scope.timeline.resolveVisibilityDefault('meeting'),
      scope.timeline.listMembers(),
    ]);
  const memberIds = members.map((m) => m.userId);
  const pinStatePromise = scope.pins.isPinnedMany([
    ...list.map((meeting) => ({ kind: 'meeting' as const, key: meeting.id })),
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
  const filteredCaptures =
    tab === 'saved'
      ? list
      : list.filter((meeting) => {
          const matchesQuery =
            !normalizedQuery ||
            [
              displayMeetingLabel(meeting),
              displaySourceLabel(meeting.platform),
              meeting.status,
            ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
          return matchesQuery && matchesCaptureFilter(meeting.status, filter);
        });
  const hasCaptureFilters = tab === 'captures' && (Boolean(query) || filter !== 'all');
  const hasSavedSearch = Boolean(query);
  const clearCurrentViewHref = meetingHref({ tab });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meetings"
        subtitle="Invite the silent notetaker or manage meeting links for automatic capture."
        metadata={[
          { label: 'This month', value: `${String(usedMinutes)} minutes`, mono: true },
          ...(cap !== null ? [{ label: 'Cap', value: `${String(cap)} minutes`, mono: true }] : []),
        ]}
      />

      <MeetingsViewNavigation tab={tab} />

      {tab === 'captures' ? (
        <div id="invite-notetaker" className="scroll-mt-24">
          <ScheduleMeetingBotForm
            defaultVisibility={defaultRow.visibility}
            defaultVisibilityUserIds={defaultRow.visibilityUserIds}
            members={memberOptions}
          />
        </div>
      ) : (
        <div id="save-meeting" className="scroll-mt-24">
          <SavedMeetingForm
            defaultVisibility={defaultRow.visibility}
            defaultVisibilityUserIds={defaultRow.visibilityUserIds}
            defaultTimezone={calendarSettings.defaultTimezone}
            members={memberOptions}
          />
        </div>
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
      ) : null}

      <MeetingCapturesSection
        clearHref={clearCurrentViewHref}
        hasActiveFilters={hasCaptureFilters}
        meetings={filteredCaptures}
        pinState={pinState}
        tab={tab}
        timezone={calendarSettings.defaultTimezone}
        totalCount={list.length}
      />
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
    <form
      action="/app/meetings"
      role="search"
      className="grid gap-3 border-y border-border py-4 sm:grid-cols-[minmax(0,1fr)_minmax(11rem,auto)_auto] sm:items-end"
    >
      <input name="tab" type="hidden" value={tab === 'saved' ? 'saved' : ''} />
      <div className="space-y-2">
        <Label htmlFor="meeting-search">
          {tab === 'saved' ? 'Search saved meetings' : 'Search captures'}
        </Label>
        <Input
          id="meeting-search"
          name="q"
          type="search"
          defaultValue={query}
          placeholder={tab === 'saved' ? 'Title, alias, or platform' : 'Title, platform, or status'}
        />
      </div>
      {tab === 'captures' ? (
        <div className="space-y-2">
          <Label htmlFor="capture-status">Filter captures</Label>
          <select
            id="capture-status"
            name="status"
            defaultValue={filter}
            className="flex h-9 w-full min-w-0 rounded-sm border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {CAPTURE_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="outline">
          Apply filters
        </Button>
        {hasActiveFilters ? (
          <Button asChild size="sm" variant="ghost">
            <Link href={clearHref}>Clear filters</Link>
          </Button>
        ) : null}
      </div>
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
        <p aria-live="polite" className="text-xs text-fg-muted">
          Showing {meetings.length} of {totalCount} saved meetings.
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
        <ul
          aria-label="Saved meetings"
          className="divide-y divide-border rounded-md border border-border"
        >
          {meetings.map((saved) => (
            <li
              id={`saved-meeting-${saved.id}`}
              key={saved.id}
              className="scroll-mt-24 space-y-3 p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="break-words font-medium text-fg">{displayMeetingLabel(saved)}</p>
                  <p className="break-words text-xs text-fg-muted">
                    {displaySourceLabel(saved.platform)} ·{' '}
                    {saved.aliases.length ? saved.aliases.join(', ') : 'no aliases'} ·{' '}
                    {saved.autoJoinEnabled ? 'auto-join on' : 'manual join'}
                  </p>
                </div>
                <fieldset
                  aria-label={`Actions for ${displayMeetingLabel(saved)}`}
                  className="flex min-w-0 flex-wrap items-center gap-2 border-0 p-0 sm:justify-end"
                >
                  <JoinSavedMeetingButton query={saved.aliases[0] ?? saved.title} />
                  <PinOverflowMenu
                    target={{ kind: 'saved_meeting', key: saved.id }}
                    title={displayMeetingLabel(saved)}
                    initialPinned={pinState[`saved_meeting:${saved.id}`] ?? false}
                  />
                  <ArchiveSavedMeetingButton savedMeetingId={saved.id} />
                </fieldset>
              </div>
              {saved.description ? (
                <p className="break-words text-sm text-fg-muted">{saved.description}</p>
              ) : null}
              <EditSavedMeetingForm saved={saved} defaultTimezone={timezone} members={members} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MeetingCapturesSection({
  clearHref,
  hasActiveFilters,
  meetings,
  pinState,
  tab,
  timezone,
  totalCount,
}: {
  clearHref: string;
  hasActiveFilters: boolean;
  meetings: MeetingRow[];
  pinState: Record<string, boolean>;
  tab: MeetingTab;
  timezone: string;
  totalCount: number;
}) {
  return (
    <section aria-labelledby="meeting-captures-heading" className="space-y-3">
      <SectionHeading id="meeting-captures-heading">
        {tab === 'saved' ? 'Scheduled and recent captures' : 'Recent captures'}
      </SectionHeading>
      {hasActiveFilters ? (
        <p aria-live="polite" className="text-xs text-fg-muted">
          Showing {meetings.length} of {totalCount} captures.
        </p>
      ) : null}
      {meetings.length === 0 ? (
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
      ) : (
        <ul
          aria-label="Meeting captures"
          className="divide-y divide-border rounded-md border border-border"
        >
          {meetings.map((meeting) => (
            <li key={meeting.id} className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Link
                  href={`/app/meetings/${meeting.id}`}
                  className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
                >
                  <span className="block break-words font-medium text-fg">
                    {displayMeetingLabel(meeting)}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
                    <span>{displaySourceLabel(meeting.platform)}</span>
                    <StatusBadge status={meeting.status} />
                    <time
                      className="font-mono tabular-nums"
                      dateTime={new Date(
                        meeting.scheduledStartAt ?? meeting.createdAt,
                      ).toISOString()}
                    >
                      {formatDisplayDateTime(meeting.scheduledStartAt ?? meeting.createdAt, {
                        timezone,
                      })}
                    </time>
                  </span>
                </Link>
                <fieldset
                  aria-label={`Actions for ${displayMeetingLabel(meeting)}`}
                  className="flex min-w-0 flex-wrap items-center gap-2 border-0 p-0 sm:justify-end"
                >
                  {meeting.status === 'scheduled' ? (
                    <SkipScheduledMeetingButton meetingId={meeting.id} />
                  ) : null}
                  <PinOverflowMenu
                    target={{ kind: 'meeting', key: meeting.id }}
                    title={displayMeetingLabel(meeting)}
                    initialPinned={pinState[`meeting:${meeting.id}`] ?? false}
                  />
                </fieldset>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
