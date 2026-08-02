// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import ChatError from '@/app/app/chat/error';
import ChatLoading from '@/app/app/chat/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Ask route states', () => {
  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])(
    'retains Ask context and lets keyboard users retry a failed load with $name',
    async ({ keys }) => {
      const user = userEvent.setup();
      const reset = vi.fn();

      render(<ChatError error={new Error('route failed')} reset={reset} />);

      expect(screen.getAllByRole('heading', { level: 1, name: 'Ask' })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 2, name: 'Unable to load Ask' })).toBeTruthy();
      expect(
        screen.getByText(
          'Your saved conversations and captured history have not changed. Check your connection, then try again.',
        ),
      ).toBeTruthy();

      const retry = screen.getByRole('button', { name: 'Try again' });
      retry.focus();
      await user.keyboard(keys);

      expect(reset).toHaveBeenCalledOnce();
    },
  );

  it('announces loading outside an inert, motion-safe Ask skeleton and retains one route heading', () => {
    const { container } = render(<ChatLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading Ask');
    expect(announcement.closest('[aria-busy="true"]')).toBeNull();
    const loading = screen.getByLabelText('Loading Ask');
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(loading.className).toContain('motion-reduce:[&_.animate-pulse]:animate-none');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Ask' })).toHaveLength(1);
    expect(screen.queryByRole('region')).toBeNull();

    const placeholder = container.querySelector('[aria-busy="true"] > [aria-hidden="true"][inert]');
    expect(placeholder).toBeTruthy();
    expect(placeholder?.querySelectorAll('a, button, input, select, textarea')).toHaveLength(0);
  });
});
