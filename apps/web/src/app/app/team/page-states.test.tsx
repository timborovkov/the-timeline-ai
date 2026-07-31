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
  it('announces loading outside the busy, route-shaped settings placeholder', () => {
    const { container } = render(<TeamLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading team settings');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading team settings').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Team', level: 1 })).toBeTruthy();

    const navigation = screen.getByRole('navigation', {
      name: 'Team settings navigation loading placeholder',
    });
    expect(navigation.className).toContain('overflow-x-auto');
    expect(navigation.className).toContain('lg:w-52');
    expect(container.querySelectorAll('[class*="h-9"]').length).toBeGreaterThanOrEqual(6);
    expect(
      screen.getByRole('region', { name: 'Team settings panels loading placeholder' }),
    ).toBeTruthy();
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

      const retry = screen.getByRole('button', { name: 'Try again' });
      retry.focus();
      await user.keyboard(keys);

      expect(reset).toHaveBeenCalledOnce();
    },
  );
});
