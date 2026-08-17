// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { DailyDigestPayload } from '@timeline/shared/messaging/format';

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
    pendingApprovals: 2,
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
  newObjects: [
    {
      id: 'person-1',
      title: 'Ada Lovelace',
      type: 'person',
      href: '/app/objects/person-1',
    },
  ],
  windowCalendar: [
    {
      id: 'cal-window',
      title: 'Launch review',
      startAt: '2026-07-15T15:00:00.000Z',
      endAt: '2026-07-15T16:00:00.000Z',
      href: '/app/calendar?view=day&date=2026-07-15&event=cal-window',
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
    expect(screen.getByText('Jul 16, 2026')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All digests' }).getAttribute('href')).toBe(
      '/app/digests',
    );
    const details = screen.getByText('Open digest').closest('details');
    expect(details).toBeTruthy();
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.textContent).toContain(
      'The launch moved forward after customer feedback arrived.',
    );
    expect(details?.textContent).toContain('The launch review finished');
    expect(screen.getByRole('region', { name: 'Activity' })).toBeTruthy();
    expect(details?.textContent).not.toContain('Activity over the past day');
    expect(details?.textContent).toContain('7 new moments');
    expect(details?.textContent).toContain('2 new proposals');
    expect(details?.textContent).toContain('2 pending approvals');
    expect(details?.textContent).toContain('3 new tasks');
    expect(
      screen.getByRole('region', { name: 'Activity' }).querySelector('.text-signal')?.textContent,
    ).toBe('7');
    expect(details?.textContent).toContain('Write launch recap');
    expect(screen.getByRole('link', { name: 'Write launch recap' }).getAttribute('href')).toBe(
      '/app/objects/task-1',
    );
    expect(screen.getByRole('link', { name: 'Write launch recap' }).className).toContain(
      'underline decoration-border',
    );
    expect(details?.textContent).toContain('Close review');
    expect(screen.getByRole('link', { name: 'Close review' }).getAttribute('href')).toBe(
      '/app/objects/task-2',
    );
    expect(details?.textContent).toContain('Internal daily call (repeating');
    expect(screen.getByRole('link', { name: 'Internal daily call' }).getAttribute('href')).toBe(
      '/app/calendar',
    );
    expect(details?.textContent).toContain('Covering');
    expect(details?.textContent).not.toContain('GitHub · 5');
    expect(details?.textContent).not.toContain('Sources in this window');
    expect(details?.textContent).toContain('Ada Lovelace');
    expect(screen.getByRole('link', { name: 'Ada Lovelace' }).getAttribute('href')).toBe(
      '/app/objects/person-1',
    );
    expect(details?.textContent).toContain('Launch review');
    expect(screen.getByRole('link', { name: 'Launch review' }).getAttribute('href')).toBe(
      '/app/calendar?view=day&date=2026-07-15&event=cal-window',
    );
    expect(details?.textContent).toContain('Grace Hopper');
  });

  it('falls back to event counts for legacy digests without activity', () => {
    const { activity: _activity, momentCount: _momentCount, ...legacyDigest } = DIGEST;
    render(<DailyDigestBlock digest={legacyDigest} />);

    const details = screen.getByText('Open digest').closest('details');
    expect(details?.textContent).toContain('12 new moments');
    expect(details?.textContent).toContain('2 pending approvals');
    expect(details?.textContent).not.toContain('2 new proposals');
  });
});
