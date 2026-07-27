// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { DailyDigestPayload } from '@timeline/shared/messaging';

import { DailyDigestBlock } from '@/components/home/daily-digest-block';

const DIGEST: DailyDigestPayload = {
  teamName: 'Acme',
  userName: 'Ada',
  timezone: 'UTC',
  windowStart: '2026-07-15T00:00:00.000Z',
  windowEnd: '2026-07-16T00:00:00.000Z',
  summary: 'The launch moved forward. Customer feedback arrived.',
  sections: [{ title: 'Highlights', items: ['Launch review completed'] }],
  pendingApprovals: 2,
  eventCount: 12,
  momentCount: 7,
  sourceDistribution: { github: 5, slack: 7 },
  objectChangesByType: { project: 3, action_item: 2 },
  newTeamMembers: [
    { userId: 'user-1', label: 'Grace Hopper', createdAt: '2026-07-15T09:00:00.000Z' },
  ],
  tasks: [],
  upcomingCalendar: [],
  links: [],
};

describe('DailyDigestBlock', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps the complete digest payload inside the disclosure', () => {
    render(<DailyDigestBlock digest={DIGEST} />);

    const details = screen.getByText('Complete digest').closest('details');
    expect(details).toBeTruthy();
    expect(details?.textContent).not.toContain('12 events');
    expect(details?.textContent).toContain('7 moments');
    expect(details?.textContent).toContain('2 approvals');
    expect(details?.textContent).toContain('GitHub · 5');
    expect(details?.textContent).toContain('Slack · 7');
    expect(details?.textContent).toContain('Project · 3');
    expect(details?.textContent).toContain('Action item · 2');
    expect(details?.textContent).toContain('Grace Hopper');
  });

  it('falls back to event counts for legacy digests without momentCount', () => {
    const { momentCount: _momentCount, ...legacyDigest } = DIGEST;
    render(<DailyDigestBlock digest={legacyDigest} />);

    const details = screen.getByText('Complete digest').closest('details');
    expect(details?.textContent).toContain('12 events');
    expect(details?.textContent).not.toContain('7 moments');
    expect(details?.textContent).toContain('2 approvals');
  });
});
