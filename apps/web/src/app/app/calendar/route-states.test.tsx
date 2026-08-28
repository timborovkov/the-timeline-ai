// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import CalendarError from '@/app/app/calendar/error';
import CalendarLoading from '@/app/app/calendar/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Calendar route states', () => {
  it('retains Work context and lets keyboard users retry a failed calendar load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<CalendarError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Calendar' })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Work' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Calendar' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Unable to load calendar' })).toBeTruthy();
    expect(
      screen.getByText(
        'Your calendar events and saved schedule changes have not changed. Try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('announces loading outside the busy fallback while keeping Work navigation available', () => {
    const { container } = render(<CalendarLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading calendar');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading calendar').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Calendar' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Calendar' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.queryByRole('region')).toBeNull();

    const visualPlaceholders = container.querySelectorAll(
      '[aria-busy="true"] > [aria-hidden="true"][inert]',
    );
    expect(visualPlaceholders).toHaveLength(2);
    const headerPlaceholder = visualPlaceholders[0];
    const contentPlaceholder = visualPlaceholders[1];
    if (!headerPlaceholder || !contentPlaceholder) {
      throw new Error('Calendar loading placeholders are missing.');
    }
    expect(headerPlaceholder.hasAttribute('inert')).toBe(true);
    expect(contentPlaceholder.hasAttribute('inert')).toBe(true);
    expect(
      headerPlaceholder.compareDocumentPosition(screen.getByRole('navigation', { name: 'Work' })),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      screen.getByRole('navigation', { name: 'Work' }).compareDocumentPosition(contentPlaceholder),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    for (const visualPlaceholder of visualPlaceholders) {
      expect(visualPlaceholder.querySelectorAll('a, button, input, select, textarea')).toHaveLength(
        0,
      );
    }
    expect(
      contentPlaceholder.querySelectorAll('.motion-reduce\\:animate-none').length,
    ).toBeGreaterThan(0);
  });
});
