import { cleanup, render, screen } from '@testing-library/react';
import type { DailyDigestPayload } from '@timeline/shared/messaging/format';
import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import { DigestHistoryTable, type DigestHistoryRow } from '@/components/home/digest-history-table';
// Test environment: happy-dom

const PAYLOAD: DailyDigestPayload = {
  teamName: 'Acme',
  userName: 'Ada',
  timezone: 'UTC',
  windowStart: '2026-07-15T00:00:00.000Z',
  windowEnd: '2026-07-16T00:00:00.000Z',
  summary: 'The launch moved forward.',
  pendingApprovals: 0,
  eventCount: 0,
  sourceDistribution: {},
  objectChangesByType: {},
  newTeamMembers: [],
  tasks: [],
  upcomingCalendar: [],
  links: [],
};
const rows = [
  {
    id: 'first',
    name: 'Daily check-in',
    status: 'sent',
    date: PAYLOAD.windowEnd,
    timezone: 'UTC',
    channels: ['telegram'],
  },
  {
    id: 'second',
    name: 'Weekly recap',
    status: 'sent',
    date: PAYLOAD.windowEnd,
    timezone: 'UTC',
    channels: ['email'],
  },
] as const satisfies readonly DigestHistoryRow[];

describe('Update history', () => {
  afterEach(cleanup);

  it('shows each schedule name and actual delivery channel in the collapsed archive', () => {
    render(<DigestHistoryTable digests={[...rows]} />);
    const daily = screen.getByRole('link', { name: /Daily check-in.*Telegram DM/ });
    expect(daily.getAttribute('href')).toBe('/app/digests?digest=first#update-first');
    expect(daily.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('link', { name: /Weekly recap.*Email/ })).toBeTruthy();
    expect(screen.queryByText(PAYLOAD.summary)).toBeNull();
  });

  it('opens only the requested record and still reads older stored reports', () => {
    render(
      <DigestHistoryTable
        selectedId="second"
        digests={[rows[0], { ...rows[1], payload: PAYLOAD }]}
      />,
    );
    expect(screen.getByRole('link', { name: /Weekly recap/ }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByRole('link', { name: /Daily check-in/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(screen.getByText(PAYLOAD.summary)).toBeTruthy();
  });
});
