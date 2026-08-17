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
  summary: 'The launch moved forward after customer feedback arrived.',
  sections: [
    {
      title: 'Highlights',
      body: 'The launch review finished and the remaining invite work is unblocked.',
      items: [],
    },
  ],
  pendingApprovals: 2,
  eventCount: 12,
  momentCount: 7,
  activity: {
    newMoments: 7,
    newProposals: 2,
    newTasks: 3,
    completedTasks: 1,
    newProjects: 1,
    newObjectsByType: { task: 3, project: 1 },
  },
  sourceDistribution: { github: 5, slack: 7 },
  objectChangesByType: { project: 3, action_item: 2 },
  newTeamMembers: [
    { userId: 'user-1', label: 'Grace Hopper', createdAt: '2026-07-15T09:00:00.000Z' },
  ],
  tasks: [
    {
      id: 'task-1',
      title: 'Write launch recap',
      status: 'todo',
      dueAt: null,
      href: '/app/objects/task-1',
    },
  ],
  completedTasks: [
    {
      id: 'task-2',
      title: 'Close review',
      status: 'done',
      dueAt: null,
      href: '/app/objects/task-2',
    },
  ],
  upcomingCalendar: [
    {
      id: 'cal-1',
      title: 'Internal daily call',
      startAt: '2026-07-17T08:00:00.000Z',
      endAt: '2026-07-17T08:30:00.000Z',
      href: '/app/calendar',
      repeating: true,
      occurrenceCount: 4,
    },
  ],
  links: [],
};

describe('DailyDigestBlock', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps the complete digest payload inside the closed disclosure', () => {
    render(<DailyDigestBlock digest={DIGEST} />);

    expect(screen.getByText('Latest digest')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All digests' }).getAttribute('href')).toBe(
      '/app/digests',
    );
    const details = screen.getByText('Open digest').closest('details');
    expect(details).toBeTruthy();
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.textContent).toContain('The launch moved forward after customer feedback arrived.');
    expect(details?.textContent).toContain('The launch review finished');
    expect(details?.textContent).toContain('Activity over the past day');
    expect(details?.textContent).toContain('7 new moments');
    expect(details?.textContent).toContain('2 new proposals');
    expect(details?.textContent).toContain('3 new tasks');
    expect(details?.textContent).toContain('Write launch recap');
    expect(details?.textContent).toContain('Close review');
    expect(details?.textContent).toContain('Internal daily call (repeating');
    expect(details?.textContent).toContain('GitHub · 5');
    expect(details?.textContent).toContain('Grace Hopper');
  });

  it('falls back to event counts for legacy digests without activity', () => {
    const { activity: _activity, momentCount: _momentCount, ...legacyDigest } = DIGEST;
    render(<DailyDigestBlock digest={legacyDigest} />);

    const details = screen.getByText('Open digest').closest('details');
    expect(details?.textContent).toContain('12 new moments');
    expect(details?.textContent).toContain('2 new proposals');
  });
});
