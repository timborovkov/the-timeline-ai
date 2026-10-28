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

const { cleanup, render, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { default: DigestsError } = await import('@/app/app/digests/error');
const { default: DigestsLoading } = await import('@/app/app/digests/loading');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Digests route states', () => {
  it('retains Work context and lets keyboard users retry a failed digest history load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<DigestsError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Digests' })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Work' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Digests' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { level: 2, name: 'Unable to load digests' })).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    await user.keyboard('{Enter}');
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('announces a row-shaped loading state', () => {
    render(<DigestsLoading />);
    expect(screen.getByLabelText('Loading digests').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Digests' })).toHaveLength(1);
  });
});
