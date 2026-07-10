// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AddCustomMcpServerLauncher, McpServersUi } from '@/components/integrations/mcp-servers';

const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

const SERVER_ID = '33333333-3333-4333-8333-333333333333';

function fetchUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function fetchJsonBody(init?: Parameters<typeof fetch>[1]): unknown {
  return typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
}

function serverRow(overrides: Partial<Parameters<typeof McpServersUi>[0]['servers'][number]> = {}) {
  return {
    id: SERVER_ID,
    name: 'Research MCP',
    url: 'https://mcp.example.test/mcp',
    authType: 'oauth',
    enabled: true,
    cachedTools: [{ name: 'search', description: 'Search customer context' }],
    disabledTools: [],
    toolsCachedAt: '2026-07-02T10:00:00.000Z',
    lastError: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  routerRefresh.mockClear();
  cleanup();
});

describe('McpServersUi', () => {
  it('adds a personal MCP server with required fields and refreshes the page', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ id: SERVER_ID }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<McpServersUi ownership="personal" servers={[]} />);

    expect(screen.getByText('No custom MCP servers connected.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '+ Add server' }));

    const add = screen.getByRole<HTMLButtonElement>('button', { name: 'Add' });
    expect(add.disabled).toBe(true);
    await user.type(screen.getByPlaceholderText('Context7'), 'Research MCP');
    await user.type(screen.getByPlaceholderText('https://mcp.example.com/mcp'), 'https://mcp.test');
    expect(add.disabled).toBe(false);
    await user.click(add);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/team/mcp-servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Research MCP',
          url: 'https://mcp.test',
          authType: 'none',
          ownership: 'personal',
        }),
      });
    });
    expect(routerRefresh).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByText('New MCP server')).toBeNull();
    });
  });

  it('starts OAuth immediately when a new OAuth server needs authorization', async () => {
    const user = userEvent.setup();
    const requests: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = fetchUrl(input);
        const body = fetchJsonBody(init);
        requests.push({ url, body });
        if (url === '/api/team/mcp-servers') {
          return Promise.resolve(
            new Response(JSON.stringify({ id: SERVER_ID, needsOauth: true }), { status: 200 }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ url: 'https://auth.example.test/authorize' }), {
            status: 200,
          }),
        );
      }),
    );

    render(<AddCustomMcpServerLauncher ownership="team" />);

    await user.click(screen.getByRole('button', { name: '+ Add custom MCP server' }));
    await user.type(screen.getByPlaceholderText('Context7'), 'OAuth MCP');
    await user.type(
      screen.getByPlaceholderText('https://mcp.example.com/mcp'),
      'https://oauth-mcp.test',
    );
    await user.selectOptions(screen.getByRole('combobox'), 'oauth');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(requests.map((request) => request.url)).toEqual([
        '/api/team/mcp-servers',
        '/api/mcp/oauth/start',
      ]);
    });
    expect(requests[0]?.body).toMatchObject({
      name: 'OAuth MCP',
      url: 'https://oauth-mcp.test',
      authType: 'oauth',
    });
    expect(requests[1]?.body).toEqual({ mcpServerId: SERVER_ID });
    expect(window.location.href).toBe('https://auth.example.test/authorize');
  });

  it('toggles and removes connected servers through the management row', async () => {
    const user = userEvent.setup();
    const requests: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = fetchUrl(input);
        requests.push({
          url,
          method: init?.method ?? 'GET',
          body: fetchJsonBody(init),
        });
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }),
    );

    render(<McpServersUi servers={[serverRow({ enabled: false, authType: 'none' })]} />);

    expect(screen.getByText('Disabled')).toBeTruthy();
    expect(screen.getByText(/Search customer context/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Enable' }));
    await waitFor(() => {
      expect(requests[0]).toEqual({
        url: `/api/team/mcp-servers/${SERVER_ID}`,
        method: 'PATCH',
        body: { enabled: true },
      });
    });
    expect(routerRefresh).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByText('Research MCP will be disconnected from this team.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(requests[1]).toEqual({
        url: `/api/team/mcp-servers/${SERVER_ID}`,
        method: 'DELETE',
        body: null,
      });
    });
    expect(routerRefresh).toHaveBeenCalledTimes(2);
  });

  it('keeps the server row unchanged and explains forbidden enable failures', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<McpServersUi servers={[serverRow({ enabled: false, authType: 'none' })]} />);
    await user.click(screen.getByRole('button', { name: 'Enable' }));

    expect(
      await screen.findByText('You do not have permission to make this change.'),
    ).toBeTruthy();
    expect(screen.getByText('Disabled')).toBeTruthy();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it('shows bounded 500 and offline errors for management mutations', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'delete_failed', reference: 'deadbeef' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockRejectedValueOnce(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);

    render(<McpServersUi servers={[serverRow({ authType: 'none' })]} />);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const confirmRemove = screen.getAllByRole('button', { name: 'Remove' }).at(-1);
    if (!confirmRemove) throw new Error('expected remove confirmation button');
    await user.click(confirmRemove);
    expect(
      await screen.findByText('The server could not be removed. Try again. Reference: deadbeef.'),
    ).toBeTruthy();
    expect(routerRefresh).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Disable' }));
    expect(
      await screen.findByText(
        'Could not disable this server because the network request failed. Check your connection and try again.',
      ),
    ).toBeTruthy();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it('blocks rapid repeated enable requests while the first request is pending', async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<McpServersUi servers={[serverRow({ enabled: false, authType: 'none' })]} />);
    const enable = screen.getByRole<HTMLButtonElement>('button', { name: 'Enable' });
    fireEvent.click(enable);
    fireEvent.click(enable);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect((await screen.findByRole<HTMLButtonElement>('button', { name: 'Enabling…' })).disabled)
      .toBe(true);
    resolveRequest?.(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await waitFor(() => expect(routerRefresh).toHaveBeenCalledOnce());
  });

  it('validates test-call JSON before posting tool arguments', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ result: 'ok' }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<McpServersUi servers={[serverRow()]} />);

    await user.click(screen.getByRole('button', { name: 'Test call' }));
    const args = screen.getByLabelText('Arguments');
    await user.clear(args);
    await user.type(args, 'not-json');
    await user.click(screen.getByRole('button', { name: 'Run test' }));
    expect(screen.getByText('Enter a valid JSON object.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'OK' }));
    await user.click(screen.getByRole('button', { name: 'Test call' }));
    await user.clear(screen.getByLabelText('Arguments'));
    fireEvent.change(screen.getByLabelText('Arguments'), { target: { value: '{"q":"Acme"}' } });
    await user.click(screen.getByRole('button', { name: 'Run test' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(`/api/team/mcp-servers/${SERVER_ID}/tools`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tool: 'mcp__33333333333343338333333333333333__search',
          args: { q: 'Acme' },
        }),
      });
    });
    expect(await screen.findByText('{"result":"ok"}')).toBeTruthy();
  });

  it('surfaces MCP reconnect results from test calls as a reconnect-specific dialog', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: 'needs_reauth',
              mcp_server_id: SERVER_ID,
              mcp_server_name: 'Research MCP',
            }),
            { status: 200 },
          ),
        ),
      ),
    );

    render(<McpServersUi servers={[serverRow()]} />);

    await user.click(screen.getByRole('button', { name: 'Test call' }));
    await user.click(screen.getByRole('button', { name: 'Run test' }));

    expect(await screen.findByText('Reconnect required')).toBeTruthy();
    expect(
      screen.getByText('Research MCP needs to be reconnected before this tool can run.'),
    ).toBeTruthy();
    expect(screen.queryByText(/needs_reauth/)).toBeNull();
  });

  it('surfaces failed MCP test calls without labeling them as successful responses', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: false, error: 'remote unavailable' }), {
            status: 200,
          }),
        ),
      ),
    );

    render(<McpServersUi servers={[serverRow()]} />);

    await user.click(screen.getByRole('button', { name: 'Test call' }));
    await user.click(screen.getByRole('button', { name: 'Run test' }));

    expect(await screen.findByText('Tool call failed')).toBeTruthy();
    expect(screen.getByText('remote unavailable')).toBeTruthy();
    expect(screen.queryByText('Tool response')).toBeNull();
  });
});
