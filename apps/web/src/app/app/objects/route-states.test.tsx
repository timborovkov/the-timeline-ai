// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import ObjectsError from '@/app/app/objects/error';
import ObjectsLoading from '@/app/app/objects/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Objects route states', () => {
  it('retains object context and lets keyboard users retry a failed load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<ObjectsError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Objects' })).toHaveLength(1);
    expect(
      screen.getByText('Projects, people, decisions, and other durable team context.'),
    ).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Work' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Objects' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { level: 2, name: 'Unable to load objects' })).toBeTruthy();
    expect(
      screen.getByText('Objects could not be loaded. Check your connection, then try again.'),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('announces loading outside the busy fallback and retains the route heading', () => {
    render(<ObjectsLoading />);

    expect(screen.getByRole('status').textContent).toBe('Loading objects');
    expect(screen.getByLabelText('Loading objects').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Objects' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Objects' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('navigation', { name: 'Loading object type filters' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Object list loading placeholder' })).toBeTruthy();
  });
});
