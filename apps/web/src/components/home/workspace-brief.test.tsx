import { cleanup, render, screen, within } from '@testing-library/react';
import type { DailyDigestPayload } from '@timeline/shared/messaging/format';
import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import { WorkspaceBrief } from '@/components/home/workspace-brief';
// Test environment: happy-dom

const DIGEST: DailyDigestPayload = {
  teamName: 'Acme',
  userName: null,
  timezone: 'UTC',
  windowStart: '2026-07-13T08:00:00.000Z',
  windowEnd: '2026-07-16T08:00:00.000Z',
  summary: 'Launch progress',
  pendingApprovals: 0,
  eventCount: 0,
  sourceDistribution: {},
  objectChangesByType: {},
  newTeamMembers: [],
  tasks: [],
  upcomingCalendar: [],
  links: [],
  update: {
    name: 'Workspace brief',
    revision: 'initial',
    detail: 'brief',
    groups: [
      {
        section: 'activity',
        items: [
          {
            title: 'The invite flow is ready for review',
            detail: 'The team finished the onboarding changes on Tuesday.',
            links: [{ label: 'Timeline', href: '/app/timeline?event=launch' }],
          },
        ],
      },
      {
        section: 'due',
        items: [
          {
            title: 'Send the offer',
            detail: 'Jul 17, 2026',
            links: [{ label: 'Task', href: '/app/objects/offer' }],
          },
        ],
      },
    ],
  },
};

describe('Workspace brief', () => {
  afterEach(cleanup);

  it('surfaces recent narrative and links the supporting timeline and upcoming work', () => {
    render(<WorkspaceBrief digest={DIGEST} />);
    const brief = screen.getByRole('region', { name: 'Workspace brief' });
    const activity = within(brief);
    expect(activity.getByRole('heading', { name: 'What happened' })).toBeTruthy();
    expect(activity.getByText('The invite flow is ready for review')).toBeTruthy();
    expect(
      activity.getByRole('link', { name: /Open Timeline evidence/ }).getAttribute('href'),
    ).toBe('/app/timeline?event=launch');
    expect(activity.getByRole('link', { name: 'Send the offer' }).getAttribute('href')).toBe(
      '/app/objects/offer',
    );
    expect(activity.getByRole('link', { name: 'Manage updates' }).getAttribute('href')).toBe(
      '/app/updates',
    );
  });

  it('provides a quiet state and a direct link to the timeline', () => {
    render(<WorkspaceBrief digest={undefined} />);
    expect(screen.getByText(/Recent activity will appear here/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View timeline' }).getAttribute('href')).toBe(
      '/app/timeline',
    );
    expect(screen.queryByRole('heading', { name: 'Upcoming tasks' })).toBeNull();
  });
});
