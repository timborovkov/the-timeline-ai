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
  scopes: ['read'],
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
    expect(screen.getByText('No active keys')).toBeTruthy();
    expect(screen.getByText(/Create a retrieval key, with optional access/)).toBeTruthy();
    expect(screen.getByText(/Bearer <create a key first>/)).toBeTruthy();
    expect(screen.getByText(/Generated JSON contains the bearer key/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeTruthy();
    expect(screen.getByText(/IFS= read -r -s TIMELINE_MCP_KEY/)).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Codex CLI (bash or zsh)' }).parentElement?.textContent,
    ).toMatch(/relaunch codex from that terminal/i);
    expect(
      screen
        .getByRole('link', {
          name: 'Copy-ready agent install guide',
        })
        .getAttribute('href'),
    ).toBe('/help/agents');
    const skillsLink = screen.getByRole('link', {
      name: 'Plugin source on GitHub',
    });
    expect(skillsLink.getAttribute('href')).toBe(
      'https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills#install-the-plugin',
    );
    expect(skillsLink.getAttribute('target')).toBe('_blank');
    expect(skillsLink.getAttribute('rel')).toBe('noreferrer');

    await user.click(screen.getByRole('button', { name: 'New key' }));
    await user.type(screen.getByPlaceholderText('Claude Desktop · personal mac'), 'Claude Desktop');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/team/mcp-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Claude Desktop', allowAgent: false }),
      });
    });
    expect(routerRefresh).toHaveBeenCalledOnce();

    expect(await screen.findByText(/New key: keep this open/)).toBeTruthy();
    expect(screen.getByText(/copy and run the command above first/i)).toBeTruthy();
    expect(screen.getByText(/dismiss it only after Codex is connected/i)).toBeTruthy();
    expect(screen.getByText('tl_mcp_live_secret_123')).toBeTruthy();
    expect(screen.queryByText(/export TIMELINE_MCP_KEY="tl_mcp_live_secret_123"/)).toBeNull();
    expect(screen.getByText(/IFS= read -r -s TIMELINE_MCP_KEY/)).toBeTruthy();
    expect(screen.getByText(new RegExp(`codex mcp add timeline --url "${MCP_URL}"`))).toBeTruthy();
    expect(screen.getByText(/"Authorization": "Bearer tl_mcp_live_secret_123"/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Connected — dismiss key' }));
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
        body: JSON.stringify({ name: '   Claude Desktop', allowAgent: false }),
      });
    });
    expect(await screen.findByText(/New key: keep this open/)).toBeTruthy();
  });

  it('requires an explicit opt-in before granting Timeline agent access', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ name: 'Operator', plaintext: 'tl_mcp_live_agent_secret' }), {
          status: 200,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<McpShareUi keys={[]} mcpUrl={MCP_URL} />);

    await user.click(screen.getByRole('button', { name: 'New key' }));
    const allowAgent = screen.getByRole<HTMLInputElement>('checkbox', {
      name: /Allow Timeline agent/,
    });
    expect(allowAgent.checked).toBe(false);
    expect(screen.getByText(/paid agent turns/)).toBeTruthy();

    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'Operator');
    await user.click(allowAgent);
    await user.click(screen.getByRole('button', { name: 'Create key' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/team/mcp-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Operator', allowAgent: true }),
      });
    });
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

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('dialog', { name: 'Create failed' })).toBeNull();

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
    expect(await screen.findByText(/New key: keep this open/)).toBeTruthy();
  });

  it('revokes active keys only after destructive confirmation', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);

    render(<McpShareUi keys={[ACTIVE_KEY]} mcpUrl={MCP_URL} />);

    const row = screen.getByRole('listitem');
    expect(within(row).getByText('CI agent')).toBeTruthy();
    expect(within(row).getAllByText(/tl_mcp_abcd/).length).toBeGreaterThan(0);
    expect(within(row).getAllByText(/never used/).length).toBeGreaterThan(0);
    expect(within(row).getByText('Retrieval')).toBeTruthy();
    expect(within(row).queryByText('Timeline agent')).toBeNull();

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
