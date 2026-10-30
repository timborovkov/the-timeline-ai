import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

// Telegram settings must remain understandable and recoverable while route data is unavailable.

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
const { default: TelegramError } = await import('@/app/app/team/telegram/error');
const { default: TelegramLoading } = await import('@/app/app/team/telegram/loading');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Telegram settings route states', () => {
  it('announces a route-shaped loading state while respecting reduced motion', () => {
    render(<TelegramLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading Telegram settings');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();

    const loadingState = screen.getByLabelText('Loading Telegram settings');
    expect(loadingState.getAttribute('aria-busy')).toBe('true');
    expect(loadingState.className).toContain('motion-reduce:[&_.animate-pulse]:animate-none');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Telegram' })).toHaveLength(1);
  });

  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])('retains Team settings context and retries with $name', async ({ keys }) => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<TelegramError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Telegram' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Team settings' }).getAttribute('href')).toBe(
      '/app/team',
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Unable to load Telegram settings' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Your Telegram links, group bindings, and captured messages have not changed. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    await user.keyboard(keys);

    expect(reset).toHaveBeenCalledOnce();
  });
});
