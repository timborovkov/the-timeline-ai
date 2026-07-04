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

interface RunHistoryFixture {
  status: string | null;
  trigger: string | null;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

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
    expect(html).toContain('Release gate');
    expect(html).toContain('2 failures');
    expect(html).toContain('missing_evidence');
    expect(html).toContain('1 raw');
    expect(html).toContain('evidence_audit:integration');
    expect(html).toContain('gate failures');
    expect(html).toContain('object:object-1');
    expect(html).toContain('projections');
    expect(html).toContain('production_sampling:closed_beta');
    expect(html).toContain('unconfirmed fixtures');
    expect(html).toContain('Run history');
    expect(html).toContain('Showing page 1 of 1');
    expect(html).toContain('Recent clusters');
    expect(html).toContain('Lumen onboarding pilot');
    expect(html).toContain('href="/app/team/reconciliation/clusters/cluster-1"');
    expect(html).toContain('href="/app/team/reconciliation/clusters/cluster-2"');
  });

  it('passes run-history filters to the dashboard snapshot and preserves them in pagination', async () => {
    fakes.getDashboardSnapshot.mockResolvedValueOnce(
      sampleDashboard({
        runHistory: {
          status: 'completed',
          trigger: 'backfill',
          page: 2,
          pageSize: 12,
          total: 25,
          totalPages: 3,
          hasPreviousPage: true,
          hasNextPage: true,
        },
      }),
    );

    const html = renderToStaticMarkup(
      await ReconciliationDashboardPage({
        searchParams: Promise.resolve({
          runStatus: 'completed',
          runTrigger: 'backfill',
          runPage: '2',
        }),
      }),
    );

    expect(fakes.getDashboardSnapshot).toHaveBeenCalledWith({
      runHistory: {
        status: 'completed',
        trigger: 'backfill',
        page: 2,
      },
    });
    expect(html).toContain('Showing page 2 of 3');
    expect(html).toContain(
      'href="/app/team/reconciliation?runStatus=completed&amp;runTrigger=backfill"',
    );
    expect(html).toContain(
      'href="/app/team/reconciliation?runStatus=completed&amp;runTrigger=backfill&amp;runPage=3"',
    );
  });

  it('redirects unauthenticated users before reading reconciliation state', async () => {
    fakes.auth.mockResolvedValueOnce(null);

    await expect(
      ReconciliationDashboardPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('redirect:/sign-in');
    expect(fakes.getDashboardSnapshot).not.toHaveBeenCalled();
  });
});

function sampleDashboard(input: { runHistory?: RunHistoryFixture } = {}) {
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
      releaseGate: {
        passed: false,
        failureCount: 2,
        failures: [
          {
            source: 'integration',
            code: 'missing_evidence',
            rawEventCount: 1,
            message: 'integration has 1 raw event without reconciliation evidence',
          },
          {
            source: 'slack',
            code: 'degraded_replay',
            rawEventCount: 1,
            message: 'slack has 1 normalized raw event without full replay evidence',
          },
        ],
      },
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
      byTrigger: [
        { key: 'manual_repair', count: 1 },
        { key: 'backfill', count: 1 },
        { key: 'eval', count: 1 },
      ],
      recent: [
        {
          id: 'run-1',
          status: 'completed',
          trigger: 'manual_repair',
          scope: 'object:object-1',
          engineVersion: 'test-v1',
          metrics: {
            mode: 'manual_repair',
            evidence_backfilled: 2,
            association_repair_count: 3,
            projection_repair_count: 1,
            output_count: 4,
          },
          createdAt: generatedAt,
        },
        {
          id: 'run-2',
          status: 'completed',
          trigger: 'backfill',
          scope: 'evidence_audit:integration',
          engineVersion: 'reconciliation-evidence-audit-2026-07',
          metrics: {
            mode: 'audit',
            source: 'integration',
            missing_raw_events: 1,
            release_gate_passed: false,
            release_gate_failure_count: 2,
          },
          createdAt: generatedAt,
        },
        {
          id: 'run-3',
          status: 'completed',
          trigger: 'eval',
          scope: 'production_sampling:closed_beta',
          engineVersion: 'production-sampling-report-v2',
          metrics: {
            mode: 'production_sampling',
            run_kind: 'closed_beta',
            sample_count: 7,
            failed_count: 1,
            fixture_candidate_count: 1,
            confirmed_fixture_candidate_count: 0,
            unconfirmed_fixture_candidate_count: 1,
          },
          createdAt: generatedAt,
        },
      ],
      history: input.runHistory ?? defaultRunHistory(),
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

function defaultRunHistory(): RunHistoryFixture {
  return {
    status: null,
    trigger: null,
    page: 1,
    pageSize: 12,
    total: 3,
    totalPages: 1,
    hasPreviousPage: false,
    hasNextPage: false,
  };
}
