// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import SourcesError from '@/app/app/sources/error';
import SourcesLoading from '@/app/app/sources/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Connections route states', () => {
  it('retains connection context and lets keyboard users retry a failed load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<SourcesError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Connections' })).toHaveLength(1);
    expect(
      screen.getByText('Capture surfaces, native sync, and live external tools.'),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Unable to load connections' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Your connection settings and captured data have not changed. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('announces loading outside the busy, route-shaped fallback and retains one route heading', () => {
    render(<SourcesLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading connections');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading connections').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Connections' })).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Connections loading placeholder' })).toBeTruthy();
  });
});
