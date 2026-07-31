// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import ObjectError from '@/app/app/objects/[id]/error';
import ObjectDetailLoading from '@/app/app/objects/[id]/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Object detail route states', () => {
  it('retains object context and lets keyboard users retry a failed load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<ObjectError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Object' })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Work' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Objects' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { level: 2, name: 'Unable to load object' })).toBeTruthy();
    expect(
      screen.getByText(
        'Object details could not be loaded. Your saved object data is unchanged. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('announces loading outside the busy fallback and retains the object detail structure', () => {
    render(<ObjectDetailLoading />);

    expect(screen.getByRole('status').textContent).toBe('Loading object');
    expect(screen.getByLabelText('Loading object').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Object' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Objects' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('region', { name: 'Object detail loading placeholder' })).toBeTruthy();
    expect(
      screen.getByRole('complementary', { name: 'Object fields loading placeholder' }),
    ).toBeTruthy();
  });
});
