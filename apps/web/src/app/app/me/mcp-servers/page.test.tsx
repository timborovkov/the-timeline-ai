import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

// The personal MCP route must query only the signed-in owner's overlay, even
// when the active team has shared MCP servers available elsewhere.

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

await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({ withTeam: fakes.withTeam }),
  () => import('@timeline/shared/team-scope'),
);
await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    redirect: fakes.redirect,
    useRouter: () => ({ back: vi.fn() }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/components/integrations/mcp-servers'),
  () => ({
    McpServersUi: ({ ownership, servers }: { ownership: string; servers: { name: string }[] }) => (
      <output>
        {ownership}:{servers.map((server) => server.name).join(',')}
      </output>
    ),
  }),
  () => import('@/components/integrations/mcp-servers'),
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
  () => ({ db: fakes.db }),
  () => import('@/lib/db'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
const { default: PersonalMcpServersPage } = await import('@/app/app/me/mcp-servers/page');

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
