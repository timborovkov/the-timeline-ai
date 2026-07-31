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
  it('labels the loading list for assistive technology', () => {
    render(<MeetingsLoading />);

    const loading = screen.getByLabelText('Loading meetings');
    expect(loading.getAttribute('aria-busy')).toBe('true');
  });

  it('explains that data is safe and lets keyboard users retry a failed load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<MeetingsError error={new Error('Database unavailable')} reset={reset} />);

    expect(screen.getByRole('heading', { name: 'Meetings', level: 1 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Unable to load meetings', level: 2 })).toBeTruthy();
    expect(
      screen.getByText(
        'Your saved links and captured transcripts are unchanged. Check your connection and try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });
});
