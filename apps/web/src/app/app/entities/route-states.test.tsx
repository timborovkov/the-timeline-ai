import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import type { ComponentType } from 'react';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportCaughtError: fakes.reportCaughtError }),
  () => import('@/lib/sentry-report'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { default: EntityError } = await import('@/app/app/entities/[id]/error');
const { default: EntityLoading } = await import('@/app/app/entities/[id]/loading');
const { default: EntitiesError } = await import('@/app/app/entities/error');
const { default: EntitiesLoading } = await import('@/app/app/entities/loading');

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

        const retry = screen.getByRole('button', { name: 'Retry' });
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
      const loading = screen.getByLabelText(label);
      expect(loading.getAttribute('aria-busy')).toBe('true');
      expect(loading.className).toContain('motion-reduce:[&_.animate-pulse]:animate-none');
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
