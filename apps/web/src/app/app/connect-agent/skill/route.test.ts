import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
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
    withTeam: () => ({ requireMembership: fakes.requireMembership }),
  }),
  () => import('@timeline/shared/team-scope'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);

const { GET } = await import('./route.js');
const { CONNECT_AGENT_SKILL_MARKDOWN } = await import('@/lib/connect-agent-content');

describe('Connect your agent SKILL.md download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
    fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
    fakes.requireMembership.mockResolvedValue('member');
  });

  it('returns the five-tool skill as an attachment for team members', async () => {
    const response = await GET();
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="SKILL.md"');
    const body = await response.text();
    expect(body).toBe(CONNECT_AGENT_SKILL_MARKDOWN);
    expect(body).toContain('timeline.search');
    expect(body).toContain('timeline.remember');
    expect(fakes.requireMembership).toHaveBeenCalledOnce();
  });
});
