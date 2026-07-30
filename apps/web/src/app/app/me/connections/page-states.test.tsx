// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PersonalConnectionsError from '@/app/app/me/connections/error';
import PersonalConnectionsLoading from '@/app/app/me/connections/loading';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Personal Connections route states', () => {
  it('announces provider-account loading with a route-shaped skeleton', () => {
    render(<PersonalConnectionsLoading />);

    expect(screen.getByLabelText('Loading provider accounts')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Loading provider accounts');
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
    expect(
      screen.getByRole('heading', { name: 'Unable to load provider accounts', level: 2 }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Your existing provider accounts and shared sources have not changed. Try again.',
      ),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
