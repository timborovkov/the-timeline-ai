import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  getCalendarSettings: vi.fn(),
  getCurrentMonthMinutes: vi.fn(),
  getMeetingSettings: vi.fn(),
  isPinnedMany: vi.fn(),
  listMeetings: vi.fn(),
  listMembers: vi.fn(),
  listSavedMeetings: vi.fn(),
  requireMembership: vi.fn(),
  resolveActiveTeam: vi.fn(),
  resolveVisibilityDefault: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));
vi.mock('@timeline/db', () => ({ users: {} }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    meetings: {
      getCurrentMonthMinutes: fakes.getCurrentMonthMinutes,
      getMeetingSettings: fakes.getMeetingSettings,
      listMeetings: fakes.listMeetings,
      listSavedMeetings: fakes.listSavedMeetings,
    },
    calendar: { getCalendarSettings: fakes.getCalendarSettings },
    pins: { isPinnedMany: fakes.isPinnedMany },
    timeline: {
      listMembers: fakes.listMembers,
      resolveVisibilityDefault: fakes.resolveVisibilityDefault,
    },
  }),
}));
vi.mock('@/components/collections/virtual-list', () => ({
  VirtualList: ({
    items,
    renderItem,
    getItemKey,
    ariaLabel,
  }: {
    items: { id: string }[];
    renderItem: (item: { id: string }, index: number) => ReactNode;
    getItemKey: (item: { id: string }, index: number) => string;
    ariaLabel?: string;
  }) => (
    <div aria-label={ariaLabel}>
      {items.map((item, index) => (
        <div key={getItemKey(item, index)}>{renderItem(item, index)}</div>
      ))}
    </div>
  ),
}));
vi.mock('@/components/meeting-forms', () => ({
  ArchiveSavedMeetingButton: () => null,
  EditSavedMeetingForm: () => null,
  JoinSavedMeetingButton: () => null,
  SavedMeetingForm: () => null,
  ScheduleMeetingBotForm: () => null,
  SkipScheduledMeetingButton: () => null,
}));
vi.mock('@/components/pins/pin-overflow-menu', () => ({
  PinOverflowMenu: () => null,
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));

const { default: MeetingsPage } = await import('./page.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.requireMembership.mockResolvedValue(undefined);
  fakes.getCurrentMonthMinutes.mockResolvedValue(12);
  fakes.getMeetingSettings.mockResolvedValue({ meetingMinutesCap: 300 });
  fakes.getCalendarSettings.mockResolvedValue({ defaultTimezone: 'UTC' });
  fakes.resolveVisibilityDefault.mockResolvedValue({
    visibility: 'team',
    visibilityUserIds: null,
  });
  fakes.listMembers.mockResolvedValue([]);
  fakes.isPinnedMany.mockResolvedValue({});
  fakes.listMeetings.mockResolvedValue([]);
  fakes.listSavedMeetings.mockResolvedValue([]);
});

describe('MeetingsPage', () => {
  it('filters visible captures by search and status without changing the team-scoped query', async () => {
    fakes.listMeetings.mockResolvedValue([
      meetingRow({ id: 'meeting-launch', title: 'Launch review', status: 'completed' }),
      meetingRow({ id: 'meeting-daily', title: 'Daily sync', status: 'pending' }),
    ]);

    const html = renderToStaticMarkup(
      await MeetingsPage({
        searchParams: Promise.resolve({ q: ' launch ', status: 'completed' }),
      }),
    );

    expect(fakes.listMeetings).toHaveBeenCalledWith({ limit: 31, cursor: null });
    expect(html).toContain('role="search"');
    expect(html).toContain('aria-label="Meeting views"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Search captures');
    expect(html).toContain('Filters');
    expect(html).toContain('Launch review');
    expect(html).not.toContain('Daily sync');
    expect(html).toContain('1 of 2');
    expect(html).toContain('href="/app/meetings"');
  });

  it('keeps the saved view selected and offers a reset when its search has no matches', async () => {
    fakes.listSavedMeetings.mockResolvedValue([
      savedMeetingRow({ title: 'Product review', aliases: ['review'] }),
    ]);

    const html = renderToStaticMarkup(
      await MeetingsPage({ searchParams: Promise.resolve({ tab: 'saved', q: 'missing' }) }),
    );

    expect(html).toContain('Search saved meetings');
    expect(html).not.toContain('Filter captures');
    expect(html).toContain('No saved meetings match your search');
    expect(html).toContain('0 of 1');
    expect(html).toContain('href="/app/meetings?tab=saved"');
    expect(html).not.toContain('Scheduled and recent captures');
    expect(html).not.toContain('Recent captures');
    expect(fakes.listMeetings).not.toHaveBeenCalled();
  });

  it('keeps the saved editor behind one Edit details disclosure', async () => {
    fakes.listSavedMeetings.mockResolvedValue([savedMeetingRow({ title: 'Quarterly planning' })]);

    const html = renderToStaticMarkup(
      await MeetingsPage({ searchParams: Promise.resolve({ tab: 'saved' }) }),
    );

    expect(html).toContain('Edit details');
    expect(html).not.toContain('Edit saved meeting');
    expect(html).toContain('Quarterly planning');
    expect(html).not.toContain('Independent capture');
    expect(html).not.toContain('aria-label="Meeting captures"');
  });

  it('does not mix capture rows into the saved meetings view', async () => {
    fakes.listSavedMeetings.mockResolvedValue([savedMeetingRow({ title: 'Quarterly planning' })]);
    fakes.listMeetings.mockResolvedValue([
      meetingRow({ id: 'meeting-independent', title: 'Independent capture' }),
    ]);

    const html = renderToStaticMarkup(
      await MeetingsPage({ searchParams: Promise.resolve({ tab: 'saved', q: 'quarterly' }) }),
    );

    expect(html).toContain('Quarterly planning');
    expect(html).not.toContain('aria-label="Meeting captures"');
    expect(html).not.toContain('Independent capture');
    expect(fakes.listMeetings).not.toHaveBeenCalled();
  });

  it('keeps unauthenticated users out before loading meeting data', async () => {
    fakes.auth.mockResolvedValueOnce(null);

    await expect(MeetingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'redirect:/sign-in',
    );

    expect(fakes.listMeetings).not.toHaveBeenCalled();
    expect(fakes.listSavedMeetings).not.toHaveBeenCalled();
  });
});

function meetingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'meeting-1',
    teamId: 'team-1',
    createdByUserId: 'user-1',
    provider: 'recall',
    providerBotId: null,
    savedMeetingId: null,
    platform: 'meet',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    title: 'Weekly product sync',
    status: 'completed',
    scheduledStartAt: null,
    scheduledEndAt: null,
    linkedCalendarEventId: null,
    defaultVisibility: 'team',
    visibilityUserIds: [],
    participants: [],
    metadata: {},
    startedAt: null,
    endedAt: null,
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
    updatedAt: new Date('2026-07-01T12:30:00.000Z'),
    ...overrides,
  };
}

function savedMeetingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'saved-meeting-1',
    teamId: 'team-1',
    createdByUserId: 'user-1',
    title: 'Weekly product sync',
    description: null,
    platform: 'meet',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    defaultVisibility: 'team',
    visibilityUserIds: [],
    permissionConfirmedAt: new Date('2026-07-01T12:00:00.000Z'),
    permissionConfirmedByUserId: 'user-1',
    scheduleConfig: null,
    durationMinutes: 30,
    autoJoinEnabled: false,
    autoJoinPausedAt: null,
    autoJoinPausedReason: null,
    consecutiveFailureCount: 0,
    archivedAt: null,
    archivedByUserId: null,
    metadata: {},
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
    updatedAt: new Date('2026-07-01T12:00:00.000Z'),
    aliases: [],
    ...overrides,
  };
}
