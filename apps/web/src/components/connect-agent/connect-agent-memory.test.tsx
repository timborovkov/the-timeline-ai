import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  updateInboundEmailWhitelistAction: vi.fn(),
  routerRefresh: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ refresh: fakes.routerRefresh }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/app/actions/teams'),
  async () => ({
    ...(await import('@/app/actions/teams')),
    updateInboundEmailWhitelistAction: fakes.updateInboundEmailWhitelistAction,
  }),
  () => import('@/app/actions/teams'),
);
await vi.mock(
  import.meta.resolve('@/lib/notify'),
  async () => ({
    ...(await import('@/lib/notify')),
    notifyAction: async ({ run }: { run: () => Promise<{ error?: string }> }) => run(),
  }),
  () => import('@/lib/notify'),
);

const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');
const { ConnectAgentMemory } = await import('./connect-agent-memory.js');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fakes.routerRefresh.mockClear();
});

describe('ConnectAgentMemory', () => {
  it('shows team email, a list-style sender editor, and one-click webhook curl once', async () => {
    fakes.updateInboundEmailWhitelistAction.mockResolvedValue({ ok: true });
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            created: true,
            plaintext: 'whk_once_token',
          }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ConnectAgentMemory
        origin="https://timeline.test"
        isAdmin
        teamEmail="acme@inbound.timeline.test"
        currentUserEmail="owner@timeline.dev"
        extraSenders={[]}
        agentWebhookConfigured={false}
      />,
    );

    expect(screen.getByLabelText('Team email').getAttribute('value')).toBe(
      'acme@inbound.timeline.test',
    );
    expect(screen.getByLabelText('Additional senders')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/comma/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Allow owner@timeline.dev' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Create agent webhook' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/team/ingest-webhooks/agent-memory', {
        method: 'POST',
      });
    });
    expect(
      screen.getByText('https://timeline.test/api/webhooks/ingest/whk_once_token'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /curl -X POST https:\/\/timeline.test\/api\/webhooks\/ingest\/whk_once_token/,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy curl' })).toBeTruthy();
  });
});
