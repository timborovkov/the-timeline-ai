import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportCaughtError: fakes.reportCaughtError }),
  () => import('@/lib/sentry-report'),
);
await vi.mock(
  import.meta.resolve('@/components/history-back-link'),
  () => ({
    HistoryBackLink: ({ fallbackHref, label }: { fallbackHref: string; label: string }) => (
      <a href={fallbackHref}>{label}</a>
    ),
  }),
  () => import('@/components/history-back-link'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { default: PersonalConnectionsError } = await import('@/app/app/me/connections/error');
const { default: PersonalConnectionsLoading } = await import('@/app/app/me/connections/loading');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Personal Connections route states', () => {
  it('announces provider-account loading with a route-shaped skeleton', () => {
    render(<PersonalConnectionsLoading />);

    expect(screen.getByLabelText('Loading provider accounts')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Loading provider accounts');
    expect(screen.getByRole('status').parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading provider accounts').getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(screen.getAllByRole('heading', { name: 'Provider accounts', level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Connections' }).getAttribute('href')).toBe(
      '/app/sources',
    );
    expect(
      screen.getByLabelText('Loading provider accounts').querySelector('[aria-hidden="true"]'),
    ).toBeTruthy();
  });

  it('keeps the route context and exposes a retry when provider accounts cannot load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(
      <PersonalConnectionsError
        error={Object.assign(new Error('Connection unavailable'), { digest: 'error-reference' })}
        reset={reset}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Provider accounts', level: 1 })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Connections' }).getAttribute('href')).toBe(
      '/app/sources',
    );
    expect(
      screen.getByRole('heading', { name: 'Unable to load provider accounts', level: 2 }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Your existing provider accounts and shared sources have not changed. Try again.',
      ),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
