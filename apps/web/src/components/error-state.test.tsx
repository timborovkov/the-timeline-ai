// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import { ErrorState } from '@/components/error-state';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(heading);
    expect(fakes.reportCaughtError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ operation: 'Unable to load workspace' }),
    );
    expect(screen.getByText('Error reference').closest('details')?.hasAttribute('open')).toBe(
      false,
    );
  });

  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])('keeps retry keyboard-operable with $name', async ({ keys }) => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<ErrorState error={new Error('route failed')} reset={reset} />);

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard(keys);

    expect(reset).toHaveBeenCalledOnce();
  });
});
