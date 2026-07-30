// @vitest-environment happy-dom

// The personal MCP route must query only the signed-in owner's overlay, even
// when the active team has shared MCP servers available elsewhere.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PersonalMcpServersPage from '@/app/app/me/mcp-servers/page';

const fakes = vi.hoisted(() => {
  const listPersonalServers = vi.fn();
  const scope = { mcp: { listPersonalServers } };
  return {
    auth: vi.fn(),
    db: {},
    listPersonalServers,
    redirect: vi.fn(),
    resolveActiveTeam: vi.fn(),
    scope,
    withTeam: vi.fn(() => scope),
  };
});

vi.mock('@timeline/shared/team-scope', () => ({ withTeam: fakes.withTeam }));
vi.mock('next/navigation', () => ({
  redirect: fakes.redirect,
  useRouter: () => ({ back: vi.fn() }),
}));
vi.mock('@/components/integrations/mcp-servers', () => ({
  McpServersUi: ({ ownership, servers }: { ownership: string; servers: { name: string }[] }) => (
    <output>
      {ownership}:{servers.map((server) => server.name).join(',')}
    </output>
  ),
}));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/db', () => ({ db: fakes.db }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Personal MCP servers page', () => {
  it('loads the signed-in owner’s personal servers and marks the client view personal', async () => {
    fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
    fakes.resolveActiveTeam.mockResolvedValue({
      active: { teamId: 'team-1', teamName: 'Acme Labs' },
    });
    fakes.listPersonalServers.mockResolvedValue([
      {
        id: 'server-1',
        name: 'Private research',
        url: 'https://mcp.example.test/mcp',
        authType: 'oauth',
        enabled: true,
        cachedTools: [],
        disabledTools: [],
        toolsCachedAt: null,
        lastError: null,
      },
    ]);

    render(await PersonalMcpServersPage());

    expect(fakes.withTeam).toHaveBeenCalledWith(fakes.db, 'team-1', 'user-1');
    expect(fakes.listPersonalServers).toHaveBeenCalledOnce();
    expect(screen.getByText('personal:Private research')).toBeTruthy();
    expect(fakes.redirect).not.toHaveBeenCalled();
  });
});
