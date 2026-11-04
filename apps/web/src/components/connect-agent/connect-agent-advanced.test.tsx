import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const routerRefresh = vi.hoisted(() => vi.fn());

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ refresh: routerRefresh }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/lib/notify'),
  async () => ({
    ...(await import('@/lib/notify')),
    notifyAction: async ({ run }: { run: () => Promise<{ error?: string }> }) => run(),
  }),
  () => import('@/lib/notify'),
);

const { cleanup, render, screen, waitFor } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { ConnectAgentAdvanced } = await import('./connect-agent-advanced.js');

const MCP_URL = 'https://timeline.test/api/mcp/server';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  routerRefresh.mockClear();
  cleanup();
});

describe('ConnectAgentAdvanced', () => {
  it('mints static keys with capture on by default', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ name: 'Cursor', plaintext: 'tla_live_secret' }), {
          status: 200,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<ConnectAgentAdvanced keys={[]} mcpUrl={MCP_URL} isAdmin />);

    await user.click(screen.getByRole('button', { name: 'New key' }));
    const allowCapture = screen.getByRole<HTMLInputElement>('checkbox', {
      name: /Allow capture notes/,
    });
    expect(allowCapture.checked).toBe(true);
    const allowAgent = screen.getByRole<HTMLInputElement>('checkbox', {
      name: /Allow Timeline agent/,
    });
    expect(allowAgent.checked).toBe(false);

    await user.type(screen.getByRole('textbox', { name: /Label/ }), 'Cursor');
    await user.click(screen.getByRole('button', { name: 'Create key' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/team/mcp-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Cursor', allowCapture: true, allowAgent: false }),
      });
    });
    expect(await screen.findByText(/New key: keep this open/)).toBeTruthy();
  });
});
