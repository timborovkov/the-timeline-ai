// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ApprovalsError from '@/app/app/approvals/error';
import ApprovalsLoading from '@/app/app/approvals/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Approvals route states', () => {
  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])(
    'retains approval and Work context and lets keyboard users retry a failed load with $name',
    async ({ keys }) => {
      const user = userEvent.setup();
      const reset = vi.fn();

      render(<ApprovalsError error={new Error('route failed')} reset={reset} />);

      expect(screen.getAllByRole('heading', { level: 1, name: 'Approvals' })).toHaveLength(1);
      expect(
        screen.getByText('Review evidence-backed changes before they become team memory.'),
      ).toBeTruthy();
      expect(screen.getByRole('navigation', { name: 'Work' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Approvals' }).getAttribute('aria-current')).toBe(
        'page',
      );
      expect(
        screen.getByRole('heading', { level: 2, name: 'Unable to load approvals' }),
      ).toBeTruthy();
      expect(
        screen.getByText(
          'Your pending approvals and saved decisions have not changed. Check your connection, then try again.',
        ),
      ).toBeTruthy();

      const retry = screen.getByRole('button', { name: 'Try again' });
      retry.focus();
      await user.keyboard(keys);

      expect(reset).toHaveBeenCalledOnce();
    },
  );

  it('announces an inert, responsive loading fallback while retaining the route heading', () => {
    const { container } = render(<ApprovalsLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading approvals');
    expect(announcement.closest('[aria-busy="true"]')).toBeNull();
    expect(screen.getByLabelText('Loading approvals').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Approvals' })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Work' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Approvals' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();

    const visualPlaceholders = container.querySelectorAll(
      '[aria-busy="true"] > [aria-hidden="true"]',
    );
    expect(visualPlaceholders.length).toBeGreaterThan(0);
    for (const visualPlaceholder of visualPlaceholders) {
      expect(
        visualPlaceholder.querySelectorAll(
          'a, button, input, select, textarea, iframe, summary, audio[controls], video[controls], [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])',
        ),
      ).toHaveLength(0);
    }
    const skeletons = [...visualPlaceholders].flatMap((placeholder) => [
      ...placeholder.querySelectorAll('.animate-pulse'),
    ]);
    expect(skeletons.length).toBeGreaterThan(0);
    for (const skeleton of skeletons) {
      expect(skeleton.className).toContain('motion-reduce:animate-none');
    }
    expect(
      [...visualPlaceholders].some((placeholder) =>
        placeholder.querySelector('[data-loading-toolbar="collection"]'),
      ),
    ).toBe(true);
  });
});
