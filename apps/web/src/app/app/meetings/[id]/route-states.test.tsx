// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ back: vi.fn(), reportCaughtError: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: fakes.back }) }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import MeetingError from '@/app/app/meetings/[id]/error';
import MeetingLoading from '@/app/app/meetings/[id]/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Meeting detail route states', () => {
  it('announces a route-shaped loading state outside the busy meeting detail', () => {
    render(<MeetingLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading meeting');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading meeting').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Meeting' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Meetings' }).getAttribute('href')).toBe(
      '/app/meetings',
    );
    expect(screen.getByRole('region', { name: 'Meeting loading placeholder' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])(
    'retains Meetings context and lets keyboard users retry a failed load with $name',
    async ({ keys }) => {
      const user = userEvent.setup();
      const reset = vi.fn();

      render(<MeetingError error={new Error('route failed')} reset={reset} />);

      expect(screen.getAllByRole('heading', { level: 1, name: 'Meeting' })).toHaveLength(1);
      expect(
        screen.getByRole('heading', { level: 2, name: 'Unable to load meeting' }),
      ).toBeTruthy();
      expect(
        screen.getByText(
          'Meeting details could not be loaded. Your captured transcript and saved meeting data are unchanged. Check your connection, then try again.',
        ),
      ).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Meetings' }).getAttribute('href')).toBe(
        '/app/meetings',
      );

      const retry = screen.getByRole('button', { name: 'Retry' });
      retry.focus();
      await user.keyboard(keys);

      expect(reset).toHaveBeenCalledOnce();
    },
  );
});
