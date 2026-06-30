import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  getDashboardSnapshot: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: fakes.redirect,
  useRouter: () => ({ back: vi.fn() }),
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    reconciliation: { getDashboardSnapshot: fakes.getDashboardSnapshot },
  }),
}));
vi.mock('@/app/actions/reconciliation', () => ({
  queueReconciliationJobFormAction: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));

const { default: ReconciliationDashboardPage } = await import('./page.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({
    active: { teamId: 'team-1', teamName: 'Acme Labs' },
  });
  fakes.getDashboardSnapshot.mockResolvedValue(sampleDashboard());
});

describe('ReconciliationDashboardPage', () => {
  it('renders visibility-filtered cluster drilldown links and bounded notices', async () => {
    const html = renderToStaticMarkup(
      await ReconciliationDashboardPage({
        searchParams: Promise.resolve({
          reconciliationNotice: 'queued',
          message: 'Queued cluster replay.',
        }),
      }),
    );

    expect(html).toContain('Queued cluster replay.');
    expect(html).toContain('Recent clusters');
    expect(html).toContain('Lumen onboarding pilot');
    expect(html).toContain('href="/app/team/reconciliation/clusters/cluster-1"');
    expect(html).toContain('href="/app/team/reconciliation/clusters/cluster-2"');
  });

  it('redirects unauthenticated users before reading reconciliation state', async () => {
    fakes.auth.mockResolvedValueOnce(null);

    await expect(
      ReconciliationDashboardPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('redirect:/sign-in');
    expect(fakes.getDashboardSnapshot).not.toHaveBeenCalled();
  });
});

function sampleDashboard() {
  const generatedAt = new Date('2026-06-30T10:00:00.000Z');
  return {
    generatedAt,
    coverageLimit: 5000,
    evidenceCoverage: {
      totalRawEvents: 12,
      normalizedRawEvents: 11,
      missingRawEvents: 1,
      fullReplayEvidence: 9,
      degradedReplayEvidence: 2,
      bySource: {
        integration: {
          totalRawEvents: 8,
          normalizedRawEvents: 7,
          missingRawEvents: 1,
          fullReplayEvidence: 6,
          degradedReplayEvidence: 1,
        },
      },
    },
    clusters: {
      total: 2,
      byKind: [{ key: 'customer_project', count: 2 }],
      recent: [
        {
          id: 'cluster-1',
          artifactClusterKind: 'customer_project',
          artifactType: 'monday_board',
          canonicalName: 'Lumen onboarding pilot',
          status: 'active',
          updatedAt: generatedAt,
        },
        {
          id: 'cluster-2',
          artifactClusterKind: 'incident',
          artifactType: 'sentry_project',
          canonicalName: 'Checkout latency incident',
          status: 'candidate',
          updatedAt: generatedAt,
        },
      ],
    },
    associations: { total: 3 },
    runs: {
      byStatus: [{ key: 'completed', count: 1 }],
      recent: [
        {
          id: 'run-1',
          status: 'completed',
          trigger: 'manual',
          scope: 'team',
          engineVersion: 'test-v1',
          createdAt: generatedAt,
        },
      ],
    },
    outputs: {
      byStatus: [{ key: 'pending', count: 1 }],
      byKind: [{ key: 'agent_suggestion_projection', count: 1 }],
      recent: [
        {
          id: 'output-1',
          clusterId: 'cluster-1',
          status: 'pending',
          requiresApproval: true,
          outputKind: 'agent_suggestion_projection',
          targetKind: 'object',
          operation: 'update',
          confidence: 'high',
          createdAt: generatedAt,
        },
      ],
    },
    projectionOutbox: { byStatus: [{ key: 'pending', count: 1 }] },
    diagnostics: {
      openConflicts: 0,
      directWritesBySource: [{ key: 'legacy_object_source_event', count: 0 }],
      ambiguityBySource: [],
      topNoActionReasons: [],
      approvalStats: {
        accepted: 1,
        rejected: 0,
        open: 1,
        totalDecided: 1,
        acceptanceRate: 1,
      },
    },
  };
}
