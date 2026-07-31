// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reset: vi.fn() }));

vi.mock('@/components/error-state', () => ({
  ErrorState: ({
    title,
    description,
    reset,
  }: {
    title: string;
    description: string;
    reset: () => void;
  }) => (
    <section aria-label="Calendar error">
      <h2>{title}</h2>
      <p>{description}</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </section>
  ),
}));
vi.mock('@/components/work-subnav', () => ({
  WorkSubnav: ({ current }: { current: string }) => (
    <nav aria-label="Work navigation">{current}</nav>
  ),
}));

const { default: CalendarError } = await import('./error.js');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CalendarError', () => {
  it('retains calendar context and offers a retry action', async () => {
    const user = userEvent.setup();
    render(<CalendarError error={new Error('offline')} reset={fakes.reset} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Work navigation' }).textContent).toContain(
      '/app/calendar',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Couldn’t load calendar' })).toBeTruthy();
    expect(
      screen.getByText('Calendar could not be loaded. Check your connection, then try again.'),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(fakes.reset).toHaveBeenCalledOnce();
  });
});
