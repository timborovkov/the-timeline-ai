// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { McpShareUi } from '@/components/integrations/mcp-share';

const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));
vi.mock('@/lib/notify', () => ({
  notifyAction: async ({ run }: { run: () => Promise<{ error?: string }> }) => run(),
}));

const MCP_URL = 'https://timeline.test/api/mcp/server';
const ACTIVE_KEY = {
  id: 'key-1',
  name: 'CI agent',
  prefix: 'tl_mcp_abcd',
  createdAt: '2026-07-02T10:00:00.000Z',
  lastUsedAt: null,
};

async function confirmRevoke(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(within(screen.getByRole('listitem')).getByRole('button', { name: 'Revoke' }));
  const confirmButton = screen.getAllByRole('button', { name: 'Revoke' }).at(-1);
  if (!confirmButton) throw new Error('expected revoke confirmation button');
  await user.click(confirmButton);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  routerRefresh.mockClear();
  cleanup();
});

describe('McpShareUi', () => {
  it('creates a team-visible bearer key from the keyboard and updates client setup snippets once', async () => {
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
    await user.keyboard('{Enter}');

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

  it('validates an empty key label, focuses the error, and submits after recovery', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ name: 'Claude Desktop', plaintext: 'tl_mcp_live_secret_123' }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<McpShareUi keys={[]} mcpUrl={MCP_URL} />);

    await user.click(screen.getByRole('button', { name: 'New key' }));
    const label = screen.getByRole<HTMLInputElement>('textbox', { name: 'Label' });
    const createButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Create key' });

    expect(createButton.type).toBe('submit');
    expect(createButton.disabled).toBe(false);
    expect(label.required).toBe(true);

    await user.type(label, '   ');
    await user.keyboard('{Enter}');

    const error = await screen.findByText('Enter a label for this key.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(label);
    expect(label.getAttribute('aria-invalid')).toBe('true');
    expect(label.getAttribute('aria-describedby')).toBe(error.id);
    expect(error.getAttribute('role')).toBe('alert');

    await user.type(label, 'Claude Desktop');
    expect(label.getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText('Enter a label for this key.')).toBeNull();

    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/team/mcp-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '   Claude Desktop' }),
      });
    });
    expect(await screen.findByText(/New key: copy now/)).toBeTruthy();
  });

  it('keeps a failed create form available for a keyboard retry', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Unable to create key.', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ name: 'Claude Desktop', plaintext: 'tl_mcp_live_secret_123' }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(<McpShareUi keys={[]} mcpUrl={MCP_URL} />);

    await user.click(screen.getByRole('button', { name: 'New key' }));
    const label = screen.getByRole<HTMLInputElement>('textbox', { name: 'Label' });
    await user.type(label, 'Claude Desktop');
    await user.keyboard('{Enter}');

    const createButton = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Create key',
    });
    expect(createButton.disabled).toBe(false);
    expect(label.value).toBe('Claude Desktop');

    await user.click(label);
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText(/New key: copy now/)).toBeTruthy();
  });

  it('revokes active keys only after destructive confirmation', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);

    render(<McpShareUi keys={[ACTIVE_KEY]} mcpUrl={MCP_URL} />);

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

  it.each([
    [403, { error: 'forbidden' }, 'You do not have permission to make this change.'],
    [
      500,
      { error: 'revoke_failed', reference: 'deadbeef' },
      'The key could not be revoked. Try again. Reference: deadbeef.',
    ],
  ])('keeps keys visible after a %s revoke response', async (status, payload, expectedMessage) => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(payload), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );

    render(<McpShareUi keys={[ACTIVE_KEY]} mcpUrl={MCP_URL} />);
    await confirmRevoke(user);

    expect(screen.queryByText(expectedMessage)).toBeNull();
    expect(screen.getByText('CI agent')).toBeTruthy();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it('explains offline revocation failures and keeps the key visible', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );

    render(<McpShareUi keys={[ACTIVE_KEY]} mcpUrl={MCP_URL} />);
    await confirmRevoke(user);

    expect(screen.getByText('CI agent')).toBeTruthy();
    expect(
      screen.queryByText(
        'Could not revoke this key because the network request failed. Check your connection and try again.',
      ),
    ).toBeNull();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it('blocks rapid repeated revoke requests while the first request is pending', async () => {
    const user = userEvent.setup();
    let resolveRequest: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<McpShareUi keys={[ACTIVE_KEY]} mcpUrl={MCP_URL} />);
    await confirmRevoke(user);
    const busyButton = await screen.findByRole<HTMLButtonElement>('button', { name: 'Revoking…' });
    fireEvent.click(busyButton);

    expect(busyButton.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    resolveRequest?.(new Response(null, { status: 204 }));
    await waitFor(() => {
      expect(routerRefresh).toHaveBeenCalledOnce();
    });
  });
});
