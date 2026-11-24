import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DailyDigestPayload } from '@timeline/shared/messaging/format';
import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import { DigestHistoryTable } from '@/components/home/digest-history-table';
import { WorkspaceTimezoneProvider } from '@/components/workspace-timezone-context';
// Test environment: happy-dom

const PAYLOAD: DailyDigestPayload = {
  teamName: 'Acme',
  userName: 'Ada',
  timezone: 'UTC',
  windowStart: '2026-07-15T00:00:00.000Z',
  windowEnd: '2026-07-16T00:00:00.000Z',
  summary: 'The launch moved forward.',
  sections: [
    {
      title: 'Highlights',
      body: 'The invite flow is ready for the next review.',
      items: [],
    },
  ],
  pendingApprovals: 0,
  eventCount: 4,
  momentCount: 3,
  sourceDistribution: {},
  objectChangesByType: {},
  newTeamMembers: [],
  tasks: [],
  upcomingCalendar: [],
  links: [],
};

describe('DigestHistoryTable', () => {
  afterEach(() => {
    cleanup();
  });

  it('opens the selected digest row so a day can be inspected', () => {
    const { container } = render(
      <DigestHistoryTable
        selectedId="digest-2"
        digests={[
          {
            id: 'digest-1',
            status: 'sent',
            summary: 'Earlier quiet day.',
            windowEnd: '2026-07-15T00:00:00.000Z',
            payload: { ...PAYLOAD, summary: 'Earlier quiet day.' },
          },
          {
            id: 'digest-2',
            status: 'generated',
            summary: 'The launch moved forward.',
            windowEnd: '2026-07-16T00:00:00.000Z',
            payload: PAYLOAD,
          },
        ]}
      />,
    );

    const selected = container.querySelector('#digest-2');
    const other = container.querySelector('#digest-1');
    expect(selected).toBeInstanceOf(HTMLDetailsElement);
    expect(other).toBeInstanceOf(HTMLDetailsElement);
    expect((selected as HTMLDetailsElement | null)?.open).toBe(true);
    expect((other as HTMLDetailsElement | null)?.open).toBe(false);
    expect(selected?.querySelector('summary')?.getAttribute('aria-expanded')).toBe('true');
    expect(other?.querySelector('summary')?.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('Jul 16, 2026')).toBeTruthy();
  });

  it('shows archive timestamps in the viewer region while retaining the original window', () => {
    const region = { locale: 'de-DE', timezone: 'America/Los_Angeles' };
    const { container } = render(
      <WorkspaceTimezoneProvider timezone="Europe/Helsinki" region={region}>
        <DigestHistoryTable
          selectedId="digest"
          digests={[
            {
              id: 'digest',
              status: 'generated',
              summary: PAYLOAD.summary,
              windowEnd: PAYLOAD.windowEnd,
              payload: PAYLOAD,
            },
          ]}
        />
      </WorkspaceTimezoneProvider>,
    );
    const day = container.querySelector('summary time');
    expect(day?.getAttribute('datetime')).toBe(PAYLOAD.windowEnd);
    expect(day?.textContent).toBe('15.07.2026');
    const times = Array.from(container.querySelectorAll('time')).slice(1);
    expect(times.map((time) => time.getAttribute('datetime'))).toEqual([
      PAYLOAD.windowStart,
      PAYLOAD.windowEnd,
    ]);
    expect(times.every((time) => time.textContent.includes('17:00'))).toBe(true);
  });

  it('localizes timed events and due dates while keeping calendar-only and legacy days', () => {
    const href = '/app/calendar?date=2026-12-01';
    const allDay = {
      id: 'day',
      title: 'Offsite',
      startAt: '2026-11-30T22:00:00.000Z',
      endAt: '2026-12-01T22:00:00.000Z',
      href,
      allDay: true,
      eventTimezone: 'Europe/Helsinki',
    };
    const legacy = {
      id: 'legacy',
      title: 'Old calendar row',
      startAt: '2026-12-01T00:15:00.000Z',
      endAt: '2026-12-01T01:15:00.000Z',
      href,
    };
    const timed = {
      ...legacy,
      id: 'timed',
      title: 'Timed review',
      allDay: false,
      eventTimezone: 'Europe/Helsinki',
    };
    const payload: DailyDigestPayload = {
      ...PAYLOAD,
      timezone: 'Europe/Helsinki',
      windowCalendar: [allDay],
      upcomingCalendar: [timed, legacy],
      tasks: [
        {
          id: 'task',
          title: 'Briefing deadline',
          dueAt: legacy.startAt,
          status: 'open',
          href: '/app/objects/task',
        },
      ],
    };
    render(
      <WorkspaceTimezoneProvider
        timezone="Europe/Helsinki"
        region={{ locale: 'de-DE', timezone: 'America/Los_Angeles' }}
      >
        <DigestHistoryTable
          selectedId="digest"
          digests={[
            {
              id: 'digest',
              status: 'generated',
              summary: payload.summary,
              windowEnd: payload.windowEnd,
              payload,
            },
          ]}
        />
      </WorkspaceTimezoneProvider>,
    );

    const timeFor = (name: string) =>
      screen.getByRole('link', { name }).closest('li')?.querySelector('time');
    expect(timeFor('Offsite')?.textContent).toBe('01.12.2026');
    expect(timeFor('Offsite')?.getAttribute('datetime')).toBe('2026-12-01');
    expect(timeFor('Timed review')?.textContent).toContain('16:15');
    expect(timeFor('Timed review')?.getAttribute('datetime')).toBe(legacy.startAt);
    expect(timeFor('Old calendar row')?.textContent).toContain('02:15');
    expect(screen.getByRole('link', { name: 'Offsite' }).getAttribute('href')).toBe(href);
    expect(
      screen.getByRole('link', { name: 'Briefing deadline' }).closest('li')?.textContent,
    ).toContain('01.12.2026');
  });

  it('lets a teammate open another day without a selected query', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <DigestHistoryTable
        digests={[
          {
            id: 'digest-1',
            status: 'sent',
            summary: 'Earlier quiet day.',
            windowEnd: '2026-07-15T00:00:00.000Z',
            payload: { ...PAYLOAD, summary: 'Earlier quiet day.' },
          },
          {
            id: 'digest-2',
            status: 'generated',
            summary: 'The launch moved forward.',
            windowEnd: '2026-07-16T00:00:00.000Z',
            payload: PAYLOAD,
          },
        ]}
      />,
    );

    const details = container.querySelector('#digest-2');
    const summary = details?.querySelector('summary');
    expect(details).toBeInstanceOf(HTMLDetailsElement);
    expect((details as HTMLDetailsElement | null)?.open).toBe(false);
    expect(summary).toBeTruthy();
    if (!summary) return;
    await user.click(summary);
    expect((details as HTMLDetailsElement | null)?.open).toBe(true);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
  });
});
