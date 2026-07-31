// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import TeamError from '@/app/app/team/error';
import TeamLoading from '@/app/app/team/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Team settings route states', () => {
  it('announces a loading state that mirrors the settings navigation and member panels', () => {
    const { container } = render(<TeamLoading />);

    const loading = screen.getByRole('status', { name: 'Loading team settings' });
    expect(loading.parentElement?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('Loading team settings')).toBeTruthy();
    expect(container.querySelectorAll('[class*="h-9"]').length).toBeGreaterThanOrEqual(4);
  });

  it('retains the team context and lets keyboard users retry a failed page load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<TeamError error={new Error('Database unavailable')} reset={reset} />);

    expect(screen.getByRole('heading', { name: 'Team', level: 1 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Couldn’t load team', level: 2 })).toBeTruthy();
    expect(screen.getByText('This page could not be loaded. Try the request again.')).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });
});
