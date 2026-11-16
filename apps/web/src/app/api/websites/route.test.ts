// HTTP boundary: session CSRF, explicit bearer grants and nested source ownership.
import { expect, vi } from '@timeline/test-support';
import { beforeEach, it } from 'bun:test';
const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  active: vi.fn(),
  bearer: vi.fn(),
  scope: vi.fn(),
  getRun: vi.fn(),
}));
await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.auth }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({ resolveActiveTeam: fakes.active }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@/lib/site-url'),
  () => ({ appUrl: (path: string) => new URL(path, 'https://timeline.test') }),
  () => import('@/lib/site-url'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/mcp-server'),
  () => ({ resolveMcpBearer: fakes.bearer }),
  () => import('@timeline/shared/mcp-server'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({ withTeam: fakes.scope }),
  () => import('@timeline/shared/team-scope'),
);
const { websiteScope, websiteInput } = await import('@/app/api/websites/_shared');
const { GET } = await import('@/app/api/websites/[id]/scans/[runId]/route');
beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user' } });
  fakes.active.mockResolvedValue({ active: { teamId: 'team' } });
  fakes.scope.mockReturnValue({ websites: { getRun: fakes.getRun } });
});
it('requires the application Origin for session mutations', async () => {
  await expect(
    websiteScope(
      new Request('https://timeline.test/api/websites', { method: 'POST' }),
      'websites:scan',
    ),
  ).rejects.toThrow('forbidden');
  await expect(
    websiteScope(
      new Request('https://timeline.test/api/websites', {
        method: 'POST',
        headers: { origin: 'https://evil.test' },
      }),
      'websites:scan',
    ),
  ).rejects.toThrow('forbidden');
  expect(fakes.scope).not.toHaveBeenCalled();
  await websiteScope(
    new Request('https://timeline.test/api/websites', {
      method: 'POST',
      headers: { origin: 'https://timeline.test' },
    }),
    'websites:scan',
  );
  expect(fakes.scope).toHaveBeenCalledWith({}, 'team', 'user');
});
it('accepts explicitly scoped bearer mutations and rejects legacy read-only credentials', async () => {
  const request = new Request('https://timeline.test/api/websites', {
    method: 'POST',
    headers: { authorization: 'Bearer test' },
  });
  const principal = { authType: 'api_key', teamId: 'team', userId: 'system', scopes: ['read'] };
  fakes.bearer.mockResolvedValue(principal);
  await expect(websiteScope(request, 'websites:scan')).rejects.toThrow('forbidden');
  fakes.bearer.mockResolvedValue({ ...principal, scopes: ['read', 'websites:scan'] });
  await websiteScope(request, 'websites:scan');
  expect(fakes.auth).not.toHaveBeenCalled();
});
it('does not return a run through another source route', async () => {
  fakes.getRun.mockResolvedValue({ websiteId: 'different-source' });
  const response = await GET(new Request('https://timeline.test/api/websites/source/scans/run'), {
    params: Promise.resolve({ id: 'source', runId: 'run' }),
  });
  expect(response.status).toBe(404);
});
it('requires explicit permission confirmation before creation', () => {
  expect(
    websiteInput.safeParse({ url: 'https://example.com', permissionConfirmed: false }).success,
  ).toBe(false);
});
