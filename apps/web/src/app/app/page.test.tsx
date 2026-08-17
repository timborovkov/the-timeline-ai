import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

// Home must compose only actionable attention with deliberately bounded, static previews.
const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  buildTimelineMoments: vi.fn(),
  captureVisibility: null as 'private' | 'team' | null,
  getCalendarSettings: vi.fn(),
  getWorkAttentionSummary: vi.fn(),
  getHomeOpenObjectCounts: vi.fn(),
  isPinnedMany: vi.fn(),
  latestDailyDigest: vi.fn(),
  listArtifactClusters: vi.fn(),
  listConnectionAttention: vi.fn(),
  listEventsPage: vi.fn(),
  listImpactItems: vi.fn(),
  listMembers: vi.fn(),
  listPins: vi.fn(),
  listRecoverableJobs: vi.fn(),
  listTimelineCapturedFilesByEventId: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  resolveActiveTeam: vi.fn(),
  resolveVisibilityDefault: vi.fn(),
  role: 'member',
  timelineFeedProps: null as {
    compact?: boolean;
    live?: boolean;
    maxMoments?: number;
  } | null,
}));

vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));
vi.mock('@timeline/db', () => ({ users: {} }));
vi.mock('@timeline/shared/messaging', () => ({ latestDailyDigest: fakes.latestDailyDigest }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: vi.fn().mockImplementation(() => Promise.resolve(fakes.role)),
    calendar: { getCalendarSettings: fakes.getCalendarSettings },
    integrations: { listConnectionAttention: fakes.listConnectionAttention },
    jobRecovery: { listRecoverableJobs: fakes.listRecoverableJobs },
    pins: { isPinnedMany: fakes.isPinnedMany, list: fakes.listPins },
    timeline: {
      listArtifactClusters: fakes.listArtifactClusters,
      listEventsPage: fakes.listEventsPage,
      listImpactItems: fakes.listImpactItems,
      listMembers: fakes.listMembers,
      resolveVisibilityDefault: fakes.resolveVisibilityDefault,
    },
  }),
}));
vi.mock('@/components/capture-form', () => ({
  CaptureForm: ({ initialVisibility }: { initialVisibility?: 'private' | 'team' }) => {
    fakes.captureVisibility = initialVisibility ?? null;
    return <div data-testid="capture-form" />;
  },
}));
vi.mock('@/components/home/capture-dialog', () => ({
  CaptureDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/home/daily-digest-block', () => ({ DailyDigestBlock: () => null }));
vi.mock('@/components/home/home-ask-composer', () => ({
  HomeAskComposer: ({ actions }: { actions?: ReactNode }) => <div>{actions}</div>,
}));
vi.mock('@/components/onboarding-checklist', () => ({
  OnboardingChecklist: () => <div data-testid="home-onboarding">Team setup checklist</div>,
}));
vi.mock('@/components/pins/pinned-workspace-preview', () => ({
  PinnedWorkspacePreview: () => null,
}));
vi.mock('@/components/timeline-feed', () => ({
  TimelineFeed: (props: { compact?: boolean; live?: boolean; maxMoments?: number }) => {
    fakes.timelineFeedProps = props;
    return <div data-testid="timeline-feed" />;
  },
}));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/hub-status', () => ({
  getWorkAttentionSummary: fakes.getWorkAttentionSummary,
  getHomeOpenObjectCounts: fakes.getHomeOpenObjectCounts,
  homeOpenObjectTotal: (counts: Record<string, number>) =>
    Object.entries(counts).reduce((sum, [type, count]) => (type === 'task' ? sum : sum + count), 0),
  homeWorkNeedingAttentionCount: (summary: { overdueTasks: number }) => summary.overdueTasks,
}));
vi.mock('@/lib/timeline-captured-files', () => ({
  listTimelineCapturedFilesByEventId: fakes.listTimelineCapturedFilesByEventId,
}));
vi.mock('@/lib/timeline-moments', () => ({ buildTimelineMoments: fakes.buildTimelineMoments }));

const { default: HomeDashboardPage } = await import('@/app/app/page');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.captureVisibility = null;
  fakes.role = 'member';
  fakes.timelineFeedProps = null;
  fakes.auth.mockResolvedValue({ user: { id: 'user-1', name: 'Ada', email: 'ada@example.com' } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.getCalendarSettings.mockResolvedValue({ defaultTimezone: 'UTC' });
  fakes.getWorkAttentionSummary.mockResolvedValue({
    attention: 0,
    overdueTasks: 0,
    pendingApprovals: 0,
  });
  fakes.getHomeOpenObjectCounts.mockResolvedValue({
    task: 0,
    follow_up: 0,
    person: 0,
    company: 0,
    project: 0,
    deal: 0,
  });
  fakes.listEventsPage.mockResolvedValue({ items: [], nextCursor: null });
  fakes.listMembers.mockResolvedValue([]);
  fakes.resolveVisibilityDefault.mockResolvedValue({ visibility: 'team' });
  fakes.listPins.mockResolvedValue({ items: [], nextCursor: null });
  fakes.latestDailyDigest.mockResolvedValue(null);
  fakes.listConnectionAttention.mockResolvedValue([]);
  fakes.listRecoverableJobs.mockResolvedValue([]);
  fakes.listImpactItems.mockResolvedValue({});
  fakes.listArtifactClusters.mockResolvedValue({});
  fakes.listTimelineCapturedFilesByEventId.mockResolvedValue({});
  fakes.buildTimelineMoments.mockReturnValue([]);
  fakes.isPinnedMany.mockResolvedValue({});
});

describe('HomeDashboardPage', () => {
  it('composes the caught-up state without zero-count attention links for a member', async () => {
    const html = renderToStaticMarkup(await HomeDashboardPage());

    expect(html).toContain('<h1 class="sr-only">Home</h1>');
    expect(html).toContain('data-testid="home-onboarding"');
    expect(html.indexOf('data-testid="home-onboarding"')).toBeLessThan(
      html.indexOf('You’re caught up'),
    );
    expect(html).toContain('You’re caught up');
    expect(html).not.toContain('href="/app/approvals"');
    expect(html).not.toContain('href="/app/work"');
    expect(html).not.toContain('href="/app/tasks"');
    expect(html).not.toContain('href="/app/objects"');
    expect(html).not.toContain('href="/app/team/jobs"');
    expect(html).not.toContain('href="/app/sources"');
    expect(fakes.listRecoverableJobs).not.toHaveBeenCalled();
  });

  it('links every nonzero admin attention group to its action', async () => {
    fakes.getWorkAttentionSummary.mockResolvedValue({
      attention: 5,
      overdueTasks: 3,
      pendingApprovals: 2,
    });
    fakes.resolveVisibilityDefault.mockResolvedValue({ visibility: 'private' });
    fakes.role = 'admin';
    fakes.listRecoverableJobs.mockResolvedValue([{}, {}]);
    fakes.listConnectionAttention.mockResolvedValue([{}, {}]);

    const html = renderToStaticMarkup(await HomeDashboardPage());

    expect(html).toContain('href="/app/approvals"');
    expect(html).toContain('href="/app/work"');
    expect(html).toContain('href="/app/team/jobs"');
    expect(html).toContain('href="/app/sources"');
    expect(html).toContain('pending approvals');
    expect(html).toContain('work needing attention');
    expect(html).toContain('recoverable jobs');
    expect(html).toContain('connection issues');
    expect(fakes.captureVisibility).toBe('private');
  });

  it('lists open tasks and a single open-objects group', async () => {
    fakes.getHomeOpenObjectCounts.mockResolvedValue({
      task: 4,
      follow_up: 0,
      person: 6,
      company: 2,
      project: 1,
      deal: 0,
    });

    const html = renderToStaticMarkup(await HomeDashboardPage());

    expect(html).toContain('href="/app/tasks"');
    expect(html).toContain('open tasks');
    expect(html).toContain('href="/app/objects"');
    expect(html).toContain('open objects');
    expect(html).toContain('People, companies, projects, and more');
    expect(html).not.toContain('href="/app/objects?type=person"');
    expect(html).not.toContain('open people');
    expect(html).not.toContain('open companies');
    expect(html).not.toContain('open projects');
    expect(html).not.toContain('open follow-ups');
    expect(html).not.toContain('open deals');
  });

  it('keeps Home previews bounded and its recent-moments feed static', async () => {
    const html = renderToStaticMarkup(await HomeDashboardPage());

    expect(fakes.listPins).toHaveBeenCalledWith({ limit: 6 });
    expect(fakes.listEventsPage).toHaveBeenCalledWith({ limit: 16 });
    expect(fakes.timelineFeedProps).toMatchObject({ compact: true, live: false, maxMoments: 8 });
    expect(html).not.toContain('>Attention<');
    expect(html).not.toContain('>Recent moments<');
    expect(html).toContain('aria-label="Recent moments"');
    expect(html).toContain('href="/app/timeline"');
    expect(html).toContain('Open timeline');
  });
});
