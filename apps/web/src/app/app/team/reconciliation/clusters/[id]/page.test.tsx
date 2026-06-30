import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CLUSTER_ID = '33333333-3333-4333-8333-333333333333';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  getClusterDetail: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('notFound');
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: fakes.redirect,
  notFound: fakes.notFound,
  useRouter: () => ({ back: vi.fn() }),
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    reconciliation: { getClusterDetail: fakes.getClusterDetail },
  }),
}));
vi.mock('@/app/actions/reconciliation', () => ({
  queueReconciliationJobFormAction: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));

const { default: ReconciliationClusterPage } = await import('./page.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.getClusterDetail.mockResolvedValue(sampleDetail());
});

describe('ReconciliationClusterPage', () => {
  it('renders visible evidence, outputs, and scoped reconcile controls for one cluster', async () => {
    const html = renderToStaticMarkup(
      await ReconciliationClusterPage({ params: Promise.resolve({ id: CLUSTER_ID }) }),
    );

    expect(fakes.getClusterDetail).toHaveBeenCalledWith({ clusterId: CLUSTER_ID });
    expect(html).toContain('Lumen onboarding pilot');
    expect(html).toContain('Reconciliation dashboard');
    expect(html).toContain('customer_project');
    expect(html).toContain('decision');
    expect(html).toContain('monday');
    expect(html).toContain('Launch pilot in July');
    expect(html).toContain('agent_suggestion_projection');
    expect(html).toContain('workspace object');
    expect(html).toContain(`name="targetId" value="${CLUSTER_ID}"`);
  });

  it('does not render rows omitted by the visibility-filtered detail model', async () => {
    const html = renderToStaticMarkup(
      await ReconciliationClusterPage({ params: Promise.resolve({ id: CLUSTER_ID }) }),
    );

    expect(html).not.toContain('Private founder note');
  });

  it('redirects unauthenticated users before loading cluster detail', async () => {
    fakes.auth.mockResolvedValueOnce(null);

    await expect(
      ReconciliationClusterPage({ params: Promise.resolve({ id: CLUSTER_ID }) }),
    ).rejects.toThrow('redirect:/sign-in');
    expect(fakes.getClusterDetail).not.toHaveBeenCalled();
  });

  it('returns not found when the active-team scope cannot see the cluster', async () => {
    fakes.getClusterDetail.mockResolvedValueOnce(null);

    await expect(
      ReconciliationClusterPage({ params: Promise.resolve({ id: CLUSTER_ID }) }),
    ).rejects.toThrow('notFound');
  });
});

function sampleDetail() {
  const now = new Date('2026-06-30T10:00:00.000Z');
  return {
    cluster: {
      id: CLUSTER_ID,
      artifactClusterKind: 'customer_project',
      artifactType: 'monday_board',
      canonicalName: 'Lumen onboarding pilot',
      canonicalEntityId: '44444444-4444-4444-8444-444444444444',
      status: 'active',
      updatedAt: now,
    },
    evidence: [
      {
        rawEventId: 'raw-event-1',
        role: 'decision',
        strength: 'high',
        authoritative: true,
        provider: 'monday',
        objectName: null,
        contentText: 'Launch pilot in July after security review.',
        externalObjectId: 'pulse-123',
      },
    ],
    outputs: [
      {
        id: 'output-1',
        outputKind: 'agent_suggestion_projection',
        status: 'pending',
        requiresApproval: true,
        targetKind: 'object',
        operation: 'update',
        confidence: 'high',
        createdAt: now,
        payload: {
          canonicalName: 'Lumen onboarding pilot',
        },
      },
    ],
  };
}
