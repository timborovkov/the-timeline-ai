// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import MeetingsError from '@/app/app/meetings/error';
import MeetingsLoading from '@/app/app/meetings/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Meetings route states', () => {
  it('announces a route-shaped loading state outside the busy Meetings fallback', () => {
    render(<MeetingsLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading meetings');
    expect(announcement.closest('[aria-busy="true"]')).toBeNull();
    expect(screen.getByLabelText('Loading meetings').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Meetings' })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Loading meeting views' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Meeting setup loading placeholder' })).toBeTruthy();
    const searchControls = screen.getByRole('region', {
      name: 'Meeting search controls loading placeholder',
    });
    expect(searchControls.querySelector('[data-loading-toolbar="collection"]')).toBeTruthy();
    const captures = screen.getByRole('region', { name: 'Meeting captures loading placeholder' });
    expect(captures.querySelectorAll('li')).toHaveLength(4);
    expect(captures.querySelector('li .min-h-11')).toBeTruthy();
    for (const skeleton of document.querySelectorAll('.animate-pulse')) {
      expect(skeleton.closest('[class*="motion-reduce"]')).toBeTruthy();
    }
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])(
    'retains Meetings context, explains that data is safe, and retries with $name',
    async ({ keys }) => {
      const user = userEvent.setup();
      const reset = vi.fn();

      render(<MeetingsError error={new Error('Database unavailable')} reset={reset} />);

      expect(screen.getAllByRole('heading', { name: 'Meetings', level: 1 })).toHaveLength(1);
      expect(
        screen.getByText(
          'Invite the silent notetaker or manage meeting links for automatic capture.',
        ),
      ).toBeTruthy();
      expect(
        screen.getByRole('heading', { name: 'Unable to load meetings', level: 2 }),
      ).toBeTruthy();
      expect(
        screen.getByText(
          'Your saved links and captured transcripts are unchanged. Check your connection and try again.',
        ),
      ).toBeTruthy();

      const retry = screen.getByRole('button', { name: 'Retry' });
      retry.focus();
      await user.keyboard(keys);

      expect(reset).toHaveBeenCalledOnce();
    },
  );
});
