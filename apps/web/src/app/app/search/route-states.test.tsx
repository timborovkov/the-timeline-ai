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
const { default: SearchError } = await import('@/app/app/search/error');
const { default: SearchLoading } = await import('@/app/app/search/loading');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Search route states', () => {
  it('retains search context and lets keyboard users retry a failed load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<SearchError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Search' })).toHaveLength(1);
    expect(
      screen.getByText(
        'Search pages, workspace objects, tasks, boards, calendar, timeline events, and documents.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Unable to load search' })).toBeTruthy();
    expect(
      screen.getByText(
        'Your query and filters have not changed. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('announces loading outside the busy, search-shaped fallback and retains one route heading', () => {
    const { getByTestId } = render(<SearchLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading search');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading search').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Search' })).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Search loading placeholder' })).toBeNull();
    expect(screen.queryByText('Search loading placeholder')).toBeNull();
    const visuals = getByTestId('search-loading-visuals');
    expect(visuals.getAttribute('aria-hidden')).toBe('true');
    expect(visuals.querySelectorAll('a, button, input, select, textarea, [tabindex]').length).toBe(
      0,
    );
  });
});
