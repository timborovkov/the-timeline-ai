// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import LegalAcceptanceError from '@/app/legal/accept/error';
import LegalAcceptanceLoading from '@/app/legal/accept/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Legal acceptance route states', () => {
  it('announces a form-shaped loading state outside the busy placeholder', () => {
    render(<LegalAcceptanceLoading />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Review The Timeline terms' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Before entering the signed-in product, accept the current Terms of Use and acknowledge the Privacy Policy.',
      ),
    ).toBeTruthy();

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading legal acceptance');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();

    const placeholder = screen.getByRole('region', {
      name: 'Legal acceptance loading placeholder',
    });
    expect(placeholder.getAttribute('aria-busy')).toBe('true');
    expect(placeholder.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    for (const skeleton of document.querySelectorAll('.animate-pulse')) {
      expect(skeleton.className).toContain('motion-reduce:animate-none');
    }
  });

  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])('retains legal context and retries safely with $name', async ({ keys }) => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<LegalAcceptanceError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Review The Timeline terms' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Unable to load legal acceptance' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'This failed load did not change your legal acceptance. If you just submitted it, that acceptance may already have succeeded. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard(keys);

    expect(reset).toHaveBeenCalledOnce();
  });
});
