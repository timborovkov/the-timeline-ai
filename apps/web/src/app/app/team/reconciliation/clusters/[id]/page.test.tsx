// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CLUSTER_ID = '33333333-3333-4333-8333-333333333333';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  getCalendarSettings: vi.fn(),
  resolveActiveTeam: vi.fn(),
  getClusterDetail: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('notFound');
  }),
  requireMembership: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: fakes.redirect,
  notFound: fakes.notFound,
  useRouter: () => ({ back: vi.fn() }),
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    calendar: { getCalendarSettings: fakes.getCalendarSettings },
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
  fakes.resolveActiveTeam.mockResolvedValue({
    active: { teamId: 'team-1', teamName: 'Acme Labs' },
  });
  fakes.requireMembership.mockResolvedValue('admin');
  fakes.getCalendarSettings.mockResolvedValue({ defaultTimezone: 'America/Los_Angeles' });
  fakes.getClusterDetail.mockResolvedValue(sampleDetail());
});

afterEach(() => {
  cleanup();
});

describe('ReconciliationClusterPage', () => {
  it('renders visible evidence, outputs, and scoped reconcile controls for one cluster', async () => {
    const html = renderToStaticMarkup(
      await ReconciliationClusterPage({ params: Promise.resolve({ id: CLUSTER_ID }) }),
    );

    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(fakes.getClusterDetail).toHaveBeenCalledWith({ clusterId: CLUSTER_ID });
    expect(html).toContain('Lumen onboarding pilot');
    expect(html).not.toContain('Reconciliation dashboard');
    expect(html).toContain('Customer project');
    expect(html).toContain('Decision');
    expect(html).toContain('Monday.com');
    expect(html).toContain('Launch pilot in July');
    expect(html).toContain('Suggestion projection');
    expect(html).toContain('Output ID: output-1');
    expect(html).toContain('Raw event ID: raw-event-1');
    expect(html).toContain('Evidence ID: evidence-1');
    expect(html).toContain('inline://monday/pulse-123');
    expect(html).toContain('View workspace item');
    expect(html).toContain(`name="targetId" value="${CLUSTER_ID}"`);
    expect(html).not.toContain('Technical details');
  });

  it('does not render rows omitted by the visibility-filtered detail model', async () => {
    const html = renderToStaticMarkup(
      await ReconciliationClusterPage({ params: Promise.resolve({ id: CLUSTER_ID }) }),
    );

    expect(html).not.toContain('Private founder note');
  });

  it('leads with human labels and team-local times while keeping ids in hover titles', async () => {
    const html = renderToStaticMarkup(
      await ReconciliationClusterPage({ params: Promise.resolve({ id: CLUSTER_ID }) }),
    );

    expect(fakes.getCalendarSettings).toHaveBeenCalledOnce();
    expect(html).toContain('Monday board');
    expect(html).toContain('Customer project');
    expect(html).toContain('Authoritative source');
    expect(html).toContain('Provider evidence');
    expect(html).toContain('Suggestion projection');
    expect(html).toContain('Update workspace memory');
    expect(html).toContain('High confidence');
    expect(html).toContain('Needs approval');
    expect(html).toContain('Jun 30, 2026, 3:00 AM');
    expect(html).toContain('America/Los_Angeles');
    expect(html).toContain('Times in America/Los_Angeles');
    expect(html).toContain('dateTime="2026-06-30T10:00:00.000Z"');
    expect(html).toContain('Cluster ID:');
    expect(html).toContain(CLUSTER_ID);
    expect(html).toContain('customer_project · monday_board · active');
    expect(html).toContain('agent_suggestion_projection');
    expect(html).toContain('approval_created');
  });

  it('renders output timestamps that match without duplicate technical-detail keys', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      render(await ReconciliationClusterPage({ params: Promise.resolve({ id: CLUSTER_ID }) }));

      expect(consoleError.mock.calls.flat().join(' ')).not.toContain(
        'Encountered two children with the same key',
      );
      expect(consoleError.mock.calls.flat().join(' ')).not.toContain('2026-06-30T10:00:00.000Z');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('copies complete output JSON from the row overflow menu', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const detail = sampleDetail();
    const payload = { body: 'x'.repeat(2_500) };
    fakes.getClusterDetail.mockResolvedValueOnce({
      ...detail,
      outputs: [{ ...detail.outputs[0], payload }],
    });

    render(await ReconciliationClusterPage({ params: Promise.resolve({ id: CLUSTER_ID }) }));
    await user.click(screen.getByRole('button', { name: 'Actions for Update workspace memory' }));
    await user.click(screen.getByRole('menuitem', { name: 'Copy payload' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledOnce();
    });
    const copied = writeText.mock.calls[0]?.[0] ?? '';
    expect(copied.length).toBeGreaterThan(2_000);
    expect(JSON.parse(copied)).toEqual(payload);
  });

  it('tells members the cluster view is admins only without loading detail', async () => {
    fakes.requireMembership.mockRejectedValueOnce(new Error('Requires admin role'));

    const html = renderToStaticMarkup(
      await ReconciliationClusterPage({ params: Promise.resolve({ id: CLUSTER_ID }) }),
    );

    expect(html).toContain('Admins only');
    expect(html).toContain('Ask an admin if you need the latest snapshot.');
    expect(html).not.toContain('Lumen onboarding pilot');
    expect(fakes.getClusterDetail).not.toHaveBeenCalled();
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
        strength: 'provider',
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
        status: 'approval_created',
        requiresApproval: true,
        targetKind: 'object',
        operation: 'update',
        confidence: 'high',
        createdAt: now,
        updatedAt: now,
        sourceRefs: [
          {
            source: 'integration',
            rawEventId: 'raw-event-1',
            evidenceId: 'evidence-1',
            sourcePayloadRef: 'inline://monday/pulse-123',
          },
        ],
        sourcePayloadRefs: ['inline://monday/pulse-123'],
        payload: {
          canonicalName: 'Lumen onboarding pilot',
        },
      },
    ],
  };
}
