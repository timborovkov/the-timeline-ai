import { expect, vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ReactNode } from 'react';

// Home must compose only actionable attention with deliberately bounded, static previews.
const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  buildTimelineMoments: vi.fn(),
  captureVisibility: null as 'private' | 'team' | null,
  getCalendarSettings: vi.fn(),
  getDashboard: vi.fn(),
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
  loadOnboardingChecklistView: vi.fn<
    (input: {
      teamId: string;
      userId: string;
      getChecklistState: () => Promise<unknown>;
    }) => Promise<{
      dismissed: boolean;
      items: { key: string; label: string; completed: boolean }[];
    }>
  >(),
  onboardingInitialData: null as { dismissed: boolean } | null,
  reportCaughtError: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  resolveActiveTeam: vi.fn(),
  resolveVisibilityDefault: vi.fn(),
  role: 'member',
  teamRow: null as { slug: string; inboundEmail: string | null } | null,
  homeTeamEmail: null as string | null,
  timelineFeedProps: null as {
    compact?: boolean;
    live?: boolean;
    maxMoments?: number;
  } | null,
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    redirect: fakes.redirect,
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@timeline/db'),
  () => ({
    users: {},
    teams: { id: 'id', slug: 'slug', inboundEmail: 'inboundEmail' },
  }),
  () => import('@timeline/db'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/messaging'),
  () => ({ latestDailyDigest: fakes.latestDailyDigest }),
  () => import('@timeline/shared/messaging'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      requireMembership: vi.fn().mockImplementation(() => Promise.resolve(fakes.role)),
      billing: { getDashboard: fakes.getDashboard },
      calendar: { getCalendarSettings: fakes.getCalendarSettings },
      integrations: { listConnectionAttention: fakes.listConnectionAttention },
      jobRecovery: { listRecoverableJobs: fakes.listRecoverableJobs },
      onboarding: { getChecklistState: vi.fn() },
      pins: { isPinnedMany: fakes.isPinnedMany, list: fakes.listPins },
      timeline: {
        listArtifactClusters: fakes.listArtifactClusters,
        listEventsPage: fakes.listEventsPage,
        listImpactItems: fakes.listImpactItems,
        listMembers: fakes.listMembers,
        resolveVisibilityDefault: fakes.resolveVisibilityDefault,
      },
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);
await vi.mock(
  import.meta.resolve('@/components/capture-form'),
  () => ({
    CaptureForm: ({ initialVisibility }: { initialVisibility?: 'private' | 'team' }) => {
      fakes.captureVisibility = initialVisibility ?? null;
      return <div data-testid="capture-form" />;
    },
  }),
  () => import('@/components/capture-form'),
);
await vi.mock(
  import.meta.resolve('@/components/home/capture-dialog'),
  () => ({
    CaptureDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  }),
  () => import('@/components/home/capture-dialog'),
);
await vi.mock(
  import.meta.resolve('@/components/home/daily-digest-block'),
  () => ({ DailyDigestBlock: () => null }),
  () => import('@/components/home/daily-digest-block'),
);
await vi.mock(
  import.meta.resolve('@/components/home/home-ask-composer'),
  () => ({
    HomeAskComposer: ({ actions }: { actions?: ReactNode }) => <div>{actions}</div>,
  }),
  () => import('@/components/home/home-ask-composer'),
);
await vi.mock(
  import.meta.resolve('@/components/onboarding-checklist'),
  () => ({
    OnboardingChecklist: ({ initialData }: { initialData?: { dismissed: boolean } | null }) => {
      fakes.onboardingInitialData = initialData ?? null;
      return <div data-testid="home-onboarding">Team setup checklist</div>;
    },
  }),
  () => import('@/components/onboarding-checklist'),
);
await vi.mock(
  import.meta.resolve('@/components/home/home-team-email'),
  () => ({
    HomeTeamEmail: ({ inboundEmail }: { inboundEmail: string | null }) => {
      fakes.homeTeamEmail = inboundEmail;
      return <div data-testid="home-team-email">Team email</div>;
    },
  }),
  () => import('@/components/home/home-team-email'),
);
await vi.mock(
  import.meta.resolve('@/components/pins/pinned-workspace-preview'),
  () => ({
    PinnedWorkspacePreview: () => <div data-testid="home-pins">Pinned work</div>,
  }),
  () => import('@/components/pins/pinned-workspace-preview'),
);
await vi.mock(
  import.meta.resolve('@/components/timeline-feed'),
  () => ({
    TimelineFeed: (props: { compact?: boolean; live?: boolean; maxMoments?: number }) => {
      fakes.timelineFeedProps = props;
      return <div data-testid="timeline-feed" />;
    },
  }),
  () => import('@/components/timeline-feed'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({ resolveActiveTeam: fakes.resolveActiveTeam }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.auth }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(fakes.teamRow ? [fakes.teamRow] : []),
          }),
        }),
      }),
    },
  }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@/lib/hub-status'),
  () => ({
    displayInboundEmail: (team: { slug: string; inboundEmail: string | null } | null) =>
      team?.inboundEmail && !team.inboundEmail.endsWith('@inbound.invalid')
        ? team.inboundEmail
        : null,
    getWorkAttentionSummary: fakes.getWorkAttentionSummary,
    getHomeOpenObjectCounts: fakes.getHomeOpenObjectCounts,
    homeOpenObjectTotal: (counts: Record<string, number>) =>
      Object.entries(counts).reduce(
        (sum, [type, count]) => (type === 'task' ? sum : sum + count),
        0,
      ),
    homeWorkNeedingAttentionCount: (summary: { overdueTasks: number }) => summary.overdueTasks,
  }),
  () => import('@/lib/hub-status'),
);
await vi.mock(
  import.meta.resolve('@/lib/onboarding-checklist'),
  () => ({
    loadOnboardingChecklistView: fakes.loadOnboardingChecklistView,
  }),
  () => import('@/lib/onboarding-checklist'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportCaughtError: fakes.reportCaughtError }),
  () => import('@/lib/sentry-report'),
);
await vi.mock(
  import.meta.resolve('@/lib/timeline-captured-files'),
  () => ({
    listTimelineCapturedFilesByEventId: fakes.listTimelineCapturedFilesByEventId,
  }),
  () => import('@/lib/timeline-captured-files'),
);
await vi.mock(
  import.meta.resolve('@/lib/timeline-moments'),
  () => ({ buildTimelineMoments: fakes.buildTimelineMoments }),
  () => import('@/lib/timeline-moments'),
);

const { default: HomeDashboardPage } = await import('@/app/app/page');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.captureVisibility = null;
  fakes.role = 'member';
  fakes.timelineFeedProps = null;
  fakes.auth.mockResolvedValue({ user: { id: 'user-1', name: 'Ada', email: 'ada@example.com' } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.getCalendarSettings.mockResolvedValue({ defaultTimezone: 'UTC' });
  fakes.getDashboard.mockResolvedValue({ nudge: null });
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
  fakes.onboardingInitialData = null;
  fakes.homeTeamEmail = null;
  fakes.teamRow = { slug: 'acme', inboundEmail: 'acme@inbound.timeline.dev' };
  fakes.loadOnboardingChecklistView.mockResolvedValue({
    dismissed: true,
    items: [{ key: 'first_note', label: 'Capture one timeline event', completed: true }],
  });
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
    expect(html).toContain('Go to the full timeline');
  });

  it('shows the copyable team email below pinned work', async () => {
    const html = renderToStaticMarkup(await HomeDashboardPage());

    expect(fakes.homeTeamEmail).toBe('acme@inbound.timeline.dev');
    expect(html).toContain('data-testid="home-team-email"');
    expect(html.indexOf('data-testid="home-pins"')).toBeLessThan(
      html.indexOf('data-testid="home-team-email"'),
    );
    expect(html.indexOf('data-testid="home-team-email"')).toBeLessThan(
      html.indexOf('aria-label="Recent moments"'),
    );
  });

  it('still renders Home when the inbound address is not configured', async () => {
    fakes.teamRow = { slug: 'acme', inboundEmail: 'acme@inbound.invalid' };

    const html = renderToStaticMarkup(await HomeDashboardPage());

    expect(html).toContain('data-testid="home-team-email"');
    expect(fakes.homeTeamEmail).toBeNull();
  });

  it('passes the server checklist snapshot into the Home setup panel', async () => {
    const snapshot = {
      dismissed: true,
      items: [{ key: 'first_note', label: 'Capture one timeline event', completed: true }],
    };
    fakes.loadOnboardingChecklistView.mockResolvedValue(snapshot);

    renderToStaticMarkup(await HomeDashboardPage());

    expect(fakes.loadOnboardingChecklistView).toHaveBeenCalledOnce();
    const loadArgs = fakes.loadOnboardingChecklistView.mock.calls[0]?.[0];
    expect(loadArgs?.teamId).toBe('team-1');
    expect(loadArgs?.userId).toBe('user-1');
    expect(typeof loadArgs?.getChecklistState).toBe('function');
    expect(fakes.onboardingInitialData).toEqual(snapshot);
  });

  it('still renders Home when the checklist snapshot fails to load', async () => {
    fakes.loadOnboardingChecklistView.mockRejectedValue(new Error('checklist unavailable'));

    const html = renderToStaticMarkup(await HomeDashboardPage());

    expect(html).toContain('data-testid="home-onboarding"');
    expect(fakes.onboardingInitialData).toBeNull();
    expect(fakes.reportCaughtError).toHaveBeenCalledWith(expect.any(Error), {
      surface: 'render',
      operation: 'onboarding_checklist',
    });
  });

  it('hides billing nudges from members', async () => {
    fakes.getDashboard.mockResolvedValue({
      nudge: {
        kind: 'free_near_limit',
        title: 'You are close to the Free allowance',
        body: 'Add a payment method before the next Ask.',
        href: '/app/team?section=billing',
        ctaLabel: 'Review billing',
      },
    });

    const html = renderToStaticMarkup(await HomeDashboardPage());

    expect(html).not.toContain('data-billing-nudge');
    expect(html).not.toContain('You are close to the Free allowance');
    expect(fakes.getDashboard).toHaveBeenCalledWith({ canManageBilling: false });
  });

  it('shows admins a one-line billing nudge', async () => {
    fakes.role = 'owner';
    fakes.getDashboard.mockResolvedValue({
      nudge: {
        kind: 'free_near_limit',
        title: 'You are close to the Free allowance',
        body: 'Add a payment method before the next Ask.',
        href: '/app/team?section=billing',
        ctaLabel: 'Review billing',
      },
    });

    const html = renderToStaticMarkup(await HomeDashboardPage());

    expect(html).toContain('data-billing-nudge="free_near_limit"');
    expect(html).toContain('You are close to the Free allowance');
    expect(html).toContain('Review billing');
    expect(html).toContain('href="/app/team?section=billing"');
    expect(html).not.toContain('Add a payment method before the next Ask.');
    expect(html).not.toContain('See pricing');
    expect(fakes.getDashboard).toHaveBeenCalledWith({ canManageBilling: true });
  });

  it('still renders Home when the billing dashboard fails to load', async () => {
    fakes.getDashboard.mockRejectedValue(new Error('billing unavailable'));

    const html = renderToStaticMarkup(await HomeDashboardPage());

    expect(html).toContain('<h1 class="sr-only">Home</h1>');
    expect(html).not.toContain('data-billing-nudge');
    expect(fakes.reportCaughtError).toHaveBeenCalledWith(expect.any(Error), {
      surface: 'render',
      operation: 'billing_dashboard',
    });
  });
});
