import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

// Legacy Team MCP bookmarks must continue to reach Integrations, while their
// transition and recovery states tell people where their settings live.

const fakes = vi.hoisted(() => ({
  back: vi.fn(),
  redirect: vi.fn(),
  reportCaughtError: vi.fn(),
  searchParams: new URLSearchParams('connected=server-1&error=retry'),
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    redirect: fakes.redirect,
    useRouter: () => ({ back: fakes.back }),
    useSearchParams: () => fakes.searchParams,
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportCaughtError: fakes.reportCaughtError }),
  () => import('@/lib/sentry-report'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { default: McpServersError } = await import('@/app/app/team/mcp-servers/error');
const { default: McpServersLoading } = await import('@/app/app/team/mcp-servers/loading');
const { default: McpServersRedirect } = await import('@/app/app/team/mcp-servers/page');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Team MCP servers route states', () => {
  it('announces that the legacy route is opening the team MCP settings', () => {
    render(<McpServersLoading />);

    expect(screen.getByLabelText('Opening team MCP server settings')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Opening team MCP server settings');
    expect(screen.getByRole('heading', { name: 'Team MCP servers', level: 1 })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Team' }).getAttribute('href')).toBe('/app/team');
    expect(screen.getByRole('link', { name: 'Integrations' }).getAttribute('href')).toBe(
      '/app/team/integrations',
    );
    expect(screen.getByLabelText('Team MCP server settings loading placeholder')).toBeTruthy();
  });

  it('keeps recovery copy and retry keyboard accessible if the redirect cannot complete', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(
      <McpServersError
        error={Object.assign(new Error('Connection unavailable'), { digest: 'error-reference' })}
        reset={reset}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Team MCP servers', level: 1 })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Unable to open team MCP servers', level: 2 }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'This failed redirect did not change your team MCP server settings. Check your connection, then try again.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Team' }).getAttribute('href')).toBe('/app/team');
    expect(screen.getByRole('link', { name: 'Integrations' }).getAttribute('href')).toBe(
      '/app/team/integrations?connected=server-1&error=retry',
    );

    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    expect(document.activeElement).toBe(retry);
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('keeps legacy callback query parameters when opening Integrations', async () => {
    await McpServersRedirect({
      searchParams: Promise.resolve({ connected: 'server-1', error: ['retry', 'ignored'] }),
    });

    expect(fakes.redirect).toHaveBeenCalledWith(
      '/app/team/integrations?connected=server-1&error=retry&error=ignored',
    );
  });
});
