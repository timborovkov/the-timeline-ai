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
  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])(
    'retains connection context and lets keyboard users retry a failed load with $name',
    async ({ keys }) => {
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
      await user.keyboard(keys);

      expect(reset).toHaveBeenCalledOnce();
    },
  );

  it('announces loading outside inert, route-shaped visuals and retains one route heading', () => {
    const { container } = render(<SourcesLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading connections');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    const loading = screen.getByLabelText('Loading connections');
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(loading.className).toContain('motion-reduce:[&_.animate-pulse]:animate-none');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Connections' })).toHaveLength(1);
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();

    const visuals = container.querySelector('[aria-busy="true"] > [aria-hidden="true"][inert]');
    expect(visuals).toBeTruthy();
    expect(
      visuals?.querySelectorAll('a, button, input, select, textarea, [tabindex]'),
    ).toHaveLength(0);
    expect(visuals?.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });
});
