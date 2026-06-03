import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-handler tests for team MCP server management. The shared MCP scope
 * owns persistence and encryption; this route owns auth/team gates, input
 * shape selection, catalog mapping, onboarding marking, and response bodies.
 */

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  listServers: vi.fn(),
  addServer: vi.fn(),
  safeMarkOnboardingStep: vi.fn(),
  listCatalog: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/onboarding', () => ({ safeMarkOnboardingStep: fakes.safeMarkOnboardingStep }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    mcp: {
      listServers: fakes.listServers,
      addServer: fakes.addServer,
    },
  }),
}));
vi.mock('@timeline/shared/integrations', () => ({ listCatalog: fakes.listCatalog }));

const { GET, POST } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';

function request(body: unknown): Request {
  return new Request('https://timeline.test/api/team/mcp-servers', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.listServers.mockResolvedValue([
    {
      id: 'server-1',
      name: 'Notion',
      url: 'https://mcp.example/sse',
      authType: 'oauth',
      enabled: true,
      cachedTools: [{ name: 'search' }],
      toolsCachedAt: new Date('2026-06-01T00:00:00.000Z'),
      lastConnectedAt: new Date('2026-06-01T01:00:00.000Z'),
      lastError: null,
      disabledTools: ['write'],
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      secretField: 'not serialized',
    },
  ]);
  fakes.addServer.mockResolvedValue({ id: 'server-1' });
  fakes.safeMarkOnboardingStep.mockResolvedValue(undefined);
  fakes.listCatalog.mockReturnValue([
    {
      id: 'notion',
      kind: 'mcp',
      label: 'Notion',
      mcpUrl: 'https://mcp.notion.test/sse',
      mcpAuthType: 'oauth',
    },
    {
      id: 'slack',
      kind: 'mcp',
      label: 'Slack',
      mcpUrl: 'https://mcp.slack.test/sse',
      mcpAuthType: 'bearer',
    },
    {
      id: 'header-app',
      kind: 'mcp',
      label: 'Header App',
      mcpUrl: 'https://mcp.header.test/sse',
      mcpAuthType: 'header',
    },
  ]);
});

describe('/api/team/mcp-servers', () => {
  it('guards auth and active team', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    const unauthenticated = await GET();
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({ error: 'unauthorized' });

    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: null });
    const noTeam = await POST(request({ catalogId: 'notion' }));
    expect(noTeam.status).toBe(400);
    await expect(noTeam.json()).resolves.toEqual({ error: 'no_team' });
  });

  it('lists servers with only client-safe fields', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      servers: [
        {
          id: 'server-1',
          name: 'Notion',
          url: 'https://mcp.example/sse',
          authType: 'oauth',
          enabled: true,
          cachedTools: [{ name: 'search' }],
          toolsCachedAt: '2026-06-01T00:00:00.000Z',
          lastConnectedAt: '2026-06-01T01:00:00.000Z',
          lastError: null,
          disabledTools: ['write'],
          createdAt: '2026-05-01T00:00:00.000Z',
        },
      ],
    });
  });

  it('creates catalog MCP servers and marks onboarding for team-owned integrations', async () => {
    const response = await POST(request({ catalogId: 'notion' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'server-1',
      catalogId: 'notion',
      needsOauth: true,
    });
    expect(fakes.addServer).toHaveBeenCalledWith({
      name: 'Notion',
      url: 'https://mcp.notion.test/sse',
      authType: 'oauth',
      authConfig: null,
    });
    expect(fakes.safeMarkOnboardingStep).toHaveBeenCalledWith(
      expect.any(Object),
      'first_integration',
    );
  });

  it('validates catalog shortcuts and required auth config', async () => {
    const unknown = await POST(request({ catalogId: 'missing' }));
    expect(unknown.status).toBe(400);
    await expect(unknown.json()).resolves.toEqual({ error: 'unknown_catalog_entry' });

    const missingBearer = await POST(request({ catalogId: 'slack' }));
    expect(missingBearer.status).toBe(400);
    await expect(missingBearer.json()).resolves.toEqual({ error: 'bearer_token_required' });

    const missingHeader = await POST(request({ catalogId: 'header-app' }));
    expect(missingHeader.status).toBe(400);
    await expect(missingHeader.json()).resolves.toEqual({ error: 'header_required' });
  });

  it('passes catalog bearer/header config and maps add failures', async () => {
    const bearer = await POST(request({ catalogId: 'slack', bearerToken: 'secret' }));
    expect(bearer.status).toBe(200);
    expect(fakes.addServer).toHaveBeenLastCalledWith({
      name: 'Slack',
      url: 'https://mcp.slack.test/sse',
      authType: 'bearer',
      authConfig: { token: 'secret' },
    });

    fakes.addServer.mockRejectedValueOnce(new Error('duplicate_server'));
    const failed = await POST(request({ catalogId: 'slack', bearerToken: 'secret' }));
    expect(failed.status).toBe(400);
    await expect(failed.json()).resolves.toEqual({ error: 'duplicate_server' });
  });

  it('creates custom servers, validates bad bodies, and skips onboarding for personal ownership', async () => {
    const badBody = await POST(request({ name: '', url: 'not-a-url', authType: 'none' }));
    expect(badBody.status).toBe(400);
    const badBodyPayload = (await badBody.json()) as { error: string };
    expect(badBodyPayload.error).toBe('bad_request');

    const response = await POST(
      request({
        name: 'Personal MCP',
        url: 'https://personal.example/sse',
        authType: 'none',
        ownership: 'personal',
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: 'server-1', needsOauth: false });
    expect(fakes.addServer).toHaveBeenCalledWith({
      name: 'Personal MCP',
      url: 'https://personal.example/sse',
      authType: 'none',
      authConfig: null,
      ownership: 'personal',
    });
    expect(fakes.safeMarkOnboardingStep).not.toHaveBeenCalled();
  });
});
