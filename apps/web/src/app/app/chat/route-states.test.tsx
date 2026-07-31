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

  it('announces loading outside the busy Ask placeholder and retains one route heading', () => {
    render(<ChatLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading Ask');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading Ask').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Ask' })).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Ask loading placeholder' })).toBeTruthy();
  });
});
