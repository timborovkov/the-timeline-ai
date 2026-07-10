// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { McpShareUi } from '@/components/integrations/mcp-share';

const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

const MCP_URL = 'https://timeline.test/api/mcp/server';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  routerRefresh.mockClear();
  cleanup();
});

describe('McpShareUi', () => {
  it('creates a team-visible bearer key and updates client setup snippets once', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            name: 'Claude Desktop',
            plaintext: 'tl_mcp_live_secret_123',
          }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<McpShareUi keys={[]} mcpUrl={MCP_URL} />);

    expect(screen.getByText('Team-visible only')).toBeTruthy();
    expect(screen.getByText('Private and specific-user events stay out.')).toBeTruthy();
    expect(
      screen.getByText(/No active keys\. Create one to let an external agent read/),
    ).toBeTruthy();
    expect(screen.getByText(/Bearer <create a key first>/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'New key' }));
    await user.type(screen.getByPlaceholderText('Claude Desktop · personal mac'), 'Claude Desktop');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/team/mcp-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Claude Desktop' }),
      });
    });
    expect(routerRefresh).toHaveBeenCalledOnce();

    expect(await screen.findByText(/New key: copy now/)).toBeTruthy();
    expect(screen.getByText('tl_mcp_live_secret_123')).toBeTruthy();
    expect(screen.getByText(/export TIMELINE_MCP_KEY="tl_mcp_live_secret_123"/)).toBeTruthy();
    expect(screen.getByText(new RegExp(`codex mcp add timeline --url "${MCP_URL}"`))).toBeTruthy();
    expect(screen.getByText(/"Authorization": "Bearer tl_mcp_live_secret_123"/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: "I've copied it, dismiss" }));
    expect(screen.queryByText('tl_mcp_live_secret_123')).toBeNull();
  });

  it('revokes active keys only after destructive confirmation', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <McpShareUi
        keys={[
          {
            id: 'key-1',
            name: 'CI agent',
            prefix: 'tl_mcp_abcd',
            createdAt: '2026-07-02T10:00:00.000Z',
            lastUsedAt: null,
          },
        ]}
        mcpUrl={MCP_URL}
      />,
    );

    const row = screen.getByRole('listitem');
    expect(within(row).getByText('CI agent')).toBeTruthy();
    expect(within(row).getByText(/tl_mcp_abcd/)).toBeTruthy();
    expect(within(row).getByText(/never used/)).toBeTruthy();

    await user.click(within(row).getByRole('button', { name: 'Revoke' }));
    expect(screen.getByText('"CI agent" will stop working for any agent using it.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(within(row).getByRole('button', { name: 'Revoke' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Revoke' });
    const confirmButton = confirmButtons.at(-1);
    if (!confirmButton) throw new Error('expected revoke confirmation button');
    await user.click(confirmButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/team/mcp-keys/key-1', { method: 'DELETE' });
    });
    expect(routerRefresh).toHaveBeenCalledOnce();
  });
});
