// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import MergeObjectsError from '@/app/app/objects/merge/error';
import MergeObjectsLoading from '@/app/app/objects/merge/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Merge objects route states', () => {
  it('retains merge context and lets keyboard users retry a failed load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<MergeObjectsError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Merge objects' })).toHaveLength(1);
    expect(
      screen.getByText('Choose the object to keep, then merge duplicates into it.'),
    ).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Work' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Objects' }).getAttribute('aria-current')).toBe('page');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Unable to load merge preview' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'The merge preview could not be loaded. No objects have been merged. Your saved object data is unchanged. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('announces loading outside an inert, motion-safe fallback with a responsive merge preview shape', () => {
    const { container } = render(<MergeObjectsLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading merge objects');
    expect(announcement.closest('[aria-busy="true"]')).toBeNull();
    const loading = screen.getByLabelText('Loading merge objects');
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(loading.className).toContain('motion-reduce:[&_.animate-pulse]:animate-none');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Merge objects' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Objects' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('navigation', { name: 'Work' })).toBeTruthy();
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();

    const visualPlaceholders = container.querySelectorAll(
      '[aria-busy="true"] > [aria-hidden="true"][inert]',
    );
    expect(visualPlaceholders.length).toBeGreaterThan(0);
    for (const placeholder of visualPlaceholders) {
      expect(placeholder.querySelectorAll('a, button, input, select, textarea')).toHaveLength(0);
    }
    expect(container.querySelector('[class~="sm:grid-cols-4"]')).toBeTruthy();
  });
});
