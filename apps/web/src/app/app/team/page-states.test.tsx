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
const { default: TeamError } = await import('@/app/app/team/error');
const { default: TeamLoading } = await import('@/app/app/team/loading');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Team settings route states', () => {
  it('keeps team context while hiding the route-shaped visual placeholder', () => {
    const { container } = render(<TeamLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading team settings');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading team settings').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Team', level: 1 })).toBeTruthy();

    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelectorAll('[class*="h-9"]').length).toBeGreaterThanOrEqual(6);
    const visualPlaceholder = container.querySelector('[aria-hidden="true"]');
    expect(visualPlaceholder).toBeTruthy();
    expect(visualPlaceholder?.querySelectorAll('a, button, input, select, textarea')).toHaveLength(
      0,
    );
  });

  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])(
    'retains team context, safe retry messaging, and keyboard retry with $name',
    async ({ keys }) => {
      const user = userEvent.setup();
      const reset = vi.fn();

      render(<TeamError error={new Error('Database unavailable')} reset={reset} />);

      expect(screen.getByRole('heading', { name: 'Team', level: 1 })).toBeTruthy();
      expect(screen.getByText('Manage members, defaults, and access.')).toBeTruthy();
      expect(
        screen.getByRole('heading', { name: 'Unable to load team settings', level: 2 }),
      ).toBeTruthy();
      expect(
        screen.getByText(
          'Your team members, access, and defaults have not changed. Check your connection, then try again.',
        ),
      ).toBeTruthy();

      const retry = screen.getByRole('button', { name: 'Retry' });
      retry.focus();
      await user.keyboard(keys);

      expect(reset).toHaveBeenCalledOnce();
    },
  );
});
