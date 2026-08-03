// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import NewObjectError from '@/app/app/objects/new/error';
import NewObjectLoading from '@/app/app/objects/new/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('New object route states', () => {
  it('retains object creation context and lets keyboard users retry a failed load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<NewObjectError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'New object' })).toHaveLength(1);
    expect(screen.getByText('Create a tracked object for your team.')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Work' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Objects' }).getAttribute('aria-current')).toBe('page');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Unable to load object creation' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'The object creation form could not be loaded. No object has been created. Your saved object data is unchanged. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('announces loading outside an inert, motion-safe fallback and retains real navigation', () => {
    const { container } = render(<NewObjectLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading new object');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    const loading = screen.getByLabelText('Loading new object');
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(loading.className).toContain('motion-reduce:[&_.animate-pulse]:animate-none');
    expect(screen.getAllByRole('heading', { level: 1, name: 'New object' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Objects' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();

    const visualPlaceholders = container.querySelectorAll(
      '[aria-busy="true"] > [aria-hidden="true"][inert]',
    );
    expect(visualPlaceholders.length).toBeGreaterThan(0);
    for (const placeholder of visualPlaceholders) {
      expect(placeholder.querySelectorAll('a, button, input, select, textarea')).toHaveLength(0);
    }
  });
});
