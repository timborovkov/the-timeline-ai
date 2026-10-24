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

    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('announces loading outside an inert, motion-safe fallback and retains real navigation', () => {
    const { container } = render(<ObjectDetailLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading object');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    const loading = screen.getByLabelText('Loading object');
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(loading.className).toContain('motion-reduce:[&_.animate-pulse]:animate-none');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Object' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Objects' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();

    const visualPlaceholders = container.querySelectorAll(
      '[aria-busy="true"] > [aria-hidden="true"][inert]',
    );
    expect(visualPlaceholders.length).toBeGreaterThan(0);
    for (const placeholder of visualPlaceholders) {
      expect(placeholder.querySelectorAll('a, button, input, select, textarea')).toHaveLength(0);
    }
  });
});
