import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({ back: vi.fn(), redirect: vi.fn(), reportCaughtError: vi.fn() }));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    redirect: fakes.redirect,
    useRouter: () => ({ back: fakes.back }),
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
const { default: McpShareError } = await import('@/app/app/team/mcp-share/error');
const { default: McpShareLoading } = await import('@/app/app/team/mcp-share/loading');
const { default: McpShareRedirect } = await import('@/app/app/team/mcp-share/page');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Timeline as MCP server route states', () => {
  it('announces that the legacy route is opening Connect your agent', () => {
    render(<McpShareLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Opening Connect your agent');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Opening Connect your agent').getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Timeline as MCP server' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Connections' }).getAttribute('href')).toBe(
      '/app/connections',
    );
  });

  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])('preserves MCP key context and retries safely with $name', async ({ keys }) => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<McpShareError error={new Error('route failed')} reset={reset} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Timeline as MCP server' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Connections' }).getAttribute('href')).toBe(
      '/app/connect-agent',
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Unable to open Timeline as MCP server' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'This failed redirect did not change your MCP settings. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    await user.keyboard(keys);

    expect(reset).toHaveBeenCalledOnce();
  });

  it('redirects the legacy MCP share route to Connect your agent', () => {
    McpShareRedirect();
    expect(fakes.redirect).toHaveBeenCalledWith('/app/connect-agent');
  });
});
