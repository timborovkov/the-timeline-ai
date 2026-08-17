// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { DailyDigestPayload } from '@timeline/shared/messaging';

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
    render(
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

    expect(
      screen
        .getByRole('button', { name: 'The launch moved forward.' })
        .getAttribute('aria-expanded'),
    ).toBe('true');
    expect(screen.getByText('The invite flow is ready for the next review.')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Earlier quiet day.' }).getAttribute('aria-expanded'),
    ).toBe('false');
  });
});
