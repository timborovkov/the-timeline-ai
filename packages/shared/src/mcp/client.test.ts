import { describe, expect, it, vi } from 'vitest';

const externalFetch = vi.hoisted(() => vi.fn());

vi.mock('#src/http/external-fetch.js', () => ({ externalFetch }));

import { McpClientManager } from '#src/mcp/client.js';

describe('McpClientManager Timeline-agent delegation', () => {
  it('reuses saved discovery during the daily cooldown without contacting any server', async () => {
    externalFetch.mockClear();
    const manager = new McpClientManager();
    const tool = {
      name: 'search',
      description: 'Search',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    };
    const server = {
      nextHealthCheckAt: new Date(Date.now() + 3600_000),
      lastError: null,
      cachedTools: [tool, { name: 'disabled' }],
      disabledTools: ['disabled'],
    };
    await expect(manager.discoverTools({} as never, server as never)).resolves.toEqual([tool]);
    expect(externalFetch).not.toHaveBeenCalled();
  });

  it('honors a failed health cooldown without another discovery request', async () => {
    externalFetch.mockClear();
    const retryAt = new Date(Date.now() + 3600_000);
    await expect(
      new McpClientManager().discoverTools(
        {} as never,
        { nextHealthCheckAt: retryAt, lastError: 'quota exhausted' } as never,
      ),
    ).rejects.toMatchObject({ retryAt });
    expect(externalFetch).not.toHaveBeenCalled();
  });

  it('propagates delegation depth and cancellation to custom MCP calls', async () => {
    const serverId = '11111111-1111-4111-8111-111111111111';
    const namespacedName = 'mcp__11111111111141118111111111111111__ask_agent';
    const controller = new AbortController();
    const manager = new McpClientManager();
    const connectForTeam = vi.spyOn(manager, 'connectForTeam').mockResolvedValue({
      tools: [],
      toolMap: new Map([[namespacedName, { serverId, toolName: 'timeline.ask_agent' }]]),
      fetchedAt: Date.now(),
    });
    const server = {
      id: serverId,
      teamId: '22222222-2222-4222-8222-222222222222',
      userId: null,
      name: 'Nested Timeline',
      url: 'https://nested.timeline.test/api/mcp/server',
      authType: 'none',
      enabled: true,
      disabledTools: [],
    };
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: vi.fn().mockResolvedValue([server]) }),
        }),
      }),
    };
    externalFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: '{"ok":true}' }] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await manager.callTool(
      db as never,
      server.teamId,
      namespacedName,
      { question: 'What changed?' },
      '00000000-0000-0000-0000-000000000000',
      { signal: controller.signal, timeoutMs: 90_000, agentDelegationDepth: 1 },
    );

    expect(connectForTeam).toHaveBeenCalledWith(
      db,
      server.teamId,
      '00000000-0000-0000-0000-000000000000',
      { signal: controller.signal, timeoutMs: 90_000, agentDelegationDepth: 1 },
    );

    const [url, init, options] = externalFetch.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; signal: AbortSignal },
      { timeoutMs: number },
    ];
    expect(url).toBe(server.url);
    expect(init.headers).toMatchObject({ 'x-timeline-agent-depth': '1' });
    expect(init.signal).toBe(controller.signal);
    expect(options.timeoutMs).toBe(90_000);
  });
});
