// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import type { DailyDigestPayload } from '@timeline/shared/messaging/format';

import { DigestHistoryTable } from '@/components/home/digest-history-table';

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
            timezone: 'UTC',
            payload: { ...PAYLOAD, summary: 'Earlier quiet day.' },
          },
          {
            id: 'digest-2',
            status: 'generated',
            summary: 'The launch moved forward.',
            windowEnd: '2026-07-16T00:00:00.000Z',
            timezone: 'UTC',
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
            timezone: 'UTC',
            payload: { ...PAYLOAD, summary: 'Earlier quiet day.' },
          },
          {
            id: 'digest-2',
            status: 'generated',
            summary: 'The launch moved forward.',
            windowEnd: '2026-07-16T00:00:00.000Z',
            timezone: 'UTC',
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
