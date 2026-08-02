// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ComponentType } from 'react';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import EntityError from '@/app/app/entities/[id]/error';
import EntityLoading from '@/app/app/entities/[id]/loading';
import EntitiesError from '@/app/app/entities/error';
import EntitiesLoading from '@/app/app/entities/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

type RouteErrorState = ComponentType<{
  error: Error & { digest?: string };
  reset: () => void;
}>;

describe('legacy entity route states', () => {
  it.each([
    {
      ErrorState: EntitiesError as RouteErrorState,
      heading: 'Objects',
      errorHeading: 'Unable to load objects',
      description: 'Objects could not be loaded. Check your connection, then try again.',
    },
    {
      ErrorState: EntityError as RouteErrorState,
      heading: 'Object',
      errorHeading: 'Unable to load object',
      description:
        'Object details could not be loaded. Your saved object data is unchanged. Check your connection, then try again.',
    },
  ])(
    'retains the $heading destination and lets keyboard users retry a failed legacy URL',
    async ({ ErrorState, heading, errorHeading, description }) => {
      for (const keys of ['{Enter}', ' ']) {
        const user = userEvent.setup();
        const reset = vi.fn();

        render(<ErrorState error={new Error('route failed')} reset={reset} />);

        expect(screen.getAllByRole('heading', { level: 1, name: heading })).toHaveLength(1);
        expect(screen.getByRole('navigation', { name: 'Work' })).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Objects' }).getAttribute('aria-current')).toBe(
          'page',
        );
        expect(screen.getByRole('heading', { level: 2, name: errorHeading })).toBeTruthy();
        expect(screen.getByText(description)).toBeTruthy();

        const retry = screen.getByRole('button', { name: 'Try again' });
        retry.focus();
        await user.keyboard(keys);

        expect(reset).toHaveBeenCalledOnce();
        cleanup();
      }
    },
  );

  it.each([
    {
      Loading: EntitiesLoading,
      heading: 'Objects',
      label: 'Loading objects',
    },
    {
      Loading: EntityLoading,
      heading: 'Object',
      label: 'Loading object',
    },
  ])(
    'announces $label outside inert visual placeholders and retains the destination context',
    ({ Loading, heading, label }) => {
      const { container } = render(<Loading />);

      const announcement = screen.getByRole('status');
      expect(announcement.textContent).toBe(label);
      expect(announcement.closest('[aria-busy="true"]')).toBeNull();
      expect(screen.getByLabelText(label).getAttribute('aria-busy')).toBe('true');
      expect(screen.getAllByRole('heading', { level: 1, name: heading })).toHaveLength(1);
      expect(screen.getByRole('navigation', { name: 'Work' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Objects' }).getAttribute('aria-current')).toBe(
        'page',
      );
      expect(screen.queryByRole('region')).toBeNull();

      const visualPlaceholders = container.querySelectorAll(
        '[aria-busy="true"] > [aria-hidden="true"][inert]',
      );
      expect(visualPlaceholders.length).toBeGreaterThan(0);
      for (const visualPlaceholder of visualPlaceholders) {
        expect(
          visualPlaceholder.querySelectorAll(
            'a, button, input, select, textarea, iframe, summary, audio[controls], video[controls], [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])',
          ),
        ).toHaveLength(0);
      }

      const allHiddenPlaceholders = container.querySelectorAll('[aria-hidden="true"]');
      for (const visualPlaceholder of allHiddenPlaceholders) {
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
    },
  );
});
