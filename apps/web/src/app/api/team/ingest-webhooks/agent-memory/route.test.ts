import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  createAgentMemoryWebhook: vi.fn(),
  trackProductEventBestEffort: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.auth }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({ resolveActiveTeam: fakes.resolveActiveTeam }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      requireMembership: fakes.requireMembership,
      ingestWebhooks: { createAgentMemoryWebhook: fakes.createAgentMemoryWebhook },
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);
await vi.mock(
  import.meta.resolve('@/lib/analytics'),
  () => ({
    trackProductEventBestEffort: fakes.trackProductEventBestEffort,
  }),
  () => import('@/lib/analytics'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportCaughtError: vi.fn() }),
  () => import('@/lib/sentry-report'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/logger'),
  () => ({
    childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  }),
  () => import('@timeline/shared/logger'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);

const { POST } = await import('./route.js');

describe('agent memory webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
    fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
    fakes.requireMembership.mockResolvedValue('admin');
  });

  it('creates the named webhook once and returns plaintext only then', async () => {
    fakes.createAgentMemoryWebhook.mockResolvedValueOnce({
      created: true,
      plaintext: 'whk_secret',
      webhook: { id: 'hook-1', name: 'Agent memory' },
    });
    const created = await POST();
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({
      created: true,
      id: 'hook-1',
      name: 'Agent memory',
      plaintext: 'whk_secret',
    });

    fakes.createAgentMemoryWebhook.mockResolvedValueOnce({
      created: false,
      webhook: { id: 'hook-1', name: 'Agent memory' },
    });
    const existing = await POST();
    expect(await existing.json()).toEqual({
      created: false,
      id: 'hook-1',
      name: 'Agent memory',
    });
  });

  it('forbids members', async () => {
    fakes.requireMembership.mockRejectedValueOnce(new Error('forbidden'));
    const response = await POST();
    expect(response.status).toBe(403);
    expect(fakes.createAgentMemoryWebhook).not.toHaveBeenCalled();
  });
});
