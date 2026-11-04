import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({ back: vi.fn(), reportCaughtError: vi.fn() }));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
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
const { default: ConnectAgentError } = await import('@/app/app/connect-agent/error');
const { default: ConnectAgentLoading } = await import('@/app/app/connect-agent/loading');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Connect your agent route states', () => {
  it('announces a route-shaped loading state', () => {
    render(<ConnectAgentLoading />);
    expect(screen.getByRole('status').textContent).toBe('Loading Connect your agent');
    expect(screen.getByLabelText('Loading Connect your agent').getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Connect your agent' })).toBeTruthy();
  });

  it('retries a failed load from the keyboard', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    render(<ConnectAgentError error={new Error('route failed')} reset={reset} />);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Unable to load Connect your agent' }),
    ).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    await user.keyboard('{Enter}');
    expect(reset).toHaveBeenCalledOnce();
  });
});
