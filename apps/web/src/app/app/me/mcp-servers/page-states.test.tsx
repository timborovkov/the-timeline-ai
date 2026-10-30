import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

// Personal MCP settings must keep their private boundary clear while loading
// or recovering so people can safely retry without assuming team settings changed.

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ back: vi.fn() }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportCaughtError: vi.fn() }),
  () => import('@/lib/sentry-report'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { default: PersonalMcpServersError } = await import('@/app/app/me/mcp-servers/error');
const { default: PersonalMcpServersLoading } = await import('@/app/app/me/mcp-servers/loading');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Personal MCP servers route states', () => {
  it('keeps personal MCP route context available while it loads', () => {
    render(<PersonalMcpServersLoading />);

    const loadingRegion = screen.getByLabelText('Opening personal MCP servers');
    expect(loadingRegion).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Opening personal MCP servers');
    expect(screen.getByRole('status').parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getAllByRole('heading', { name: 'Personal MCP servers', level: 1 })).toHaveLength(
      1,
    );
    expect(screen.getByRole('link', { name: 'Connections' })).toBeTruthy();
    expect(loadingRegion.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('keeps private recovery copy and retry keyboard accessible', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(
      <PersonalMcpServersError
        error={Object.assign(new Error('Connection unavailable'), { digest: 'error-reference' })}
        reset={reset}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Personal MCP servers', level: 1 })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Connections' })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Unable to open personal MCP servers', level: 2 }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Your personal server settings have not changed. Check your connection and try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    expect(document.activeElement).toBe(retry);
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });
});
