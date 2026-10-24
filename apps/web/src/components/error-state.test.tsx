// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import { ErrorState } from '@/components/error-state';
import { resetStaleServerActionReloadGuardForTests } from '@/lib/stale-server-action';

beforeEach(() => {
  window.history.replaceState({}, '', '/app/boards/secret-board-id');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetStaleServerActionReloadGuardForTests();
});

describe('ErrorState', () => {
  it('moves focus to the route failure heading and reports the original error', () => {
    const error = Object.assign(new Error('route failed'), { digest: 'error-reference' });

    render(
      <ErrorState
        title="Unable to load workspace"
        description="Your saved workspace data has not changed."
        error={error}
      />,
    );

    const heading = screen.getByRole('heading', { level: 2, name: 'Unable to load workspace' });
    expect(screen.getByRole('alert').className).toContain('rounded-lg');
    expect(screen.getByRole('alert').className).not.toContain('rounded-sm');
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(heading);
    expect(fakes.reportCaughtError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ operation: 'Unable to load workspace' }),
    );
    expect(screen.getByText('Error reference').closest('details')?.hasAttribute('open')).toBe(
      false,
    );
    const support = screen.getByRole('link', { name: 'Get support' });
    expect(support.getAttribute('href')).toBe(
      '/help/support?surface=board_detail&error=error-reference',
    );
    expect(support.getAttribute('href')).not.toContain('secret-board-id');
    expect(support.getAttribute('target')).toBe('_blank');
  });

  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])('keeps retry keyboard-operable with $name', async ({ keys }) => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<ErrorState error={new Error('route failed')} reset={reset} />);

    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    await user.keyboard(keys);

    expect(reset).toHaveBeenCalledOnce();
  });

  it('shows a reload affordance for stale server-action errors without reporting them', () => {
    const error = new Error(
      'Server Action "408e336cb54bf606304291ef6c2da057f97d0fc0b2" was not found on the server.',
    );
    error.name = 'UnrecognizedActionError';

    render(<ErrorState title="Unable to load tasks" error={error} reset={vi.fn()} />);

    expect(fakes.reportCaughtError).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'Timeline was updated while this tab was open. Reload to pick up the latest app version, then try again.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });
});
