// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ back: vi.fn(), reportCaughtError: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: fakes.back }) }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import ClusterError from '@/app/app/team/reconciliation/clusters/[id]/error';
import ClusterLoading from '@/app/app/team/reconciliation/clusters/[id]/loading';
import ReconciliationError from '@/app/app/team/reconciliation/error';
import ReconciliationLoading from '@/app/app/team/reconciliation/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Reconciliation route states', () => {
  it.each([
    {
      heading: 'Reconciliation',
      loadingLabel: 'Loading reconciliation',
      placeholderLabel: 'Reconciliation loading placeholder',
      backHref: '/app/team',
      Loading: ReconciliationLoading,
    },
    {
      heading: 'Reconciliation cluster',
      loadingLabel: 'Loading reconciliation cluster',
      placeholderLabel: 'Reconciliation cluster loading placeholder',
      backHref: '/app/team/reconciliation',
      Loading: ClusterLoading,
    },
  ])(
    'announces a route-shaped $heading loading state with one page heading',
    ({ heading, loadingLabel, placeholderLabel, backHref, Loading }) => {
      render(<Loading />);

      const announcement = screen.getByRole('status');
      expect(announcement.textContent).toBe(loadingLabel);
      expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
      expect(screen.getByLabelText(loadingLabel).getAttribute('aria-busy')).toBe('true');
      expect(screen.getAllByRole('heading', { level: 1, name: heading })).toHaveLength(1);
      expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe(backHref);
      expect(screen.queryByRole('button')).toBeNull();

      if (heading === 'Reconciliation') {
        const placeholder = screen.getByRole('region', { name: placeholderLabel });
        expect(placeholder.querySelectorAll('.min-h-11')).toHaveLength(6);
        expect(placeholder.querySelector('[data-loading-section="advanced-tools"]')).toBeTruthy();
        expect(placeholder.querySelectorAll('.min-h-48')).toHaveLength(0);
      } else {
        const placeholder = document.querySelector(`[aria-label="${placeholderLabel}"]`);
        expect(placeholder).toBeTruthy();
        expect(screen.queryByRole('region', { name: placeholderLabel })).toBeNull();
      }
    },
  );

  it('keeps cluster navigation available while hiding visual loading chrome from assistive technology', () => {
    render(<ClusterLoading />);

    expect(screen.getByRole('status').textContent).toBe('Loading reconciliation cluster');
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe(
      '/app/team/reconciliation',
    );

    const headerSkeleton = document.querySelector('[aria-label="Loading"]');
    expect(headerSkeleton?.parentElement?.getAttribute('aria-hidden')).toBe('true');

    const placeholder = document.querySelector(
      '[aria-label="Reconciliation cluster loading placeholder"]',
    );
    expect(placeholder?.parentElement?.getAttribute('aria-hidden')).toBe('true');
    expect(
      placeholder?.parentElement?.querySelectorAll('a, button, input, select, textarea'),
    ).toHaveLength(0);
  });

  it.each([
    { keyName: 'Enter', keys: '{Enter}' },
    { keyName: 'Space', keys: ' ' },
  ])(
    'keeps reconciliation context, a safe message, and keyboard retry with $keyName',
    async ({ keys }) => {
      const cases = [
        {
          ErrorPage: ReconciliationError,
          heading: 'Reconciliation',
          errorHeading: 'Unable to load reconciliation',
          backHref: '/app/team',
        },
        {
          ErrorPage: ClusterError,
          heading: 'Reconciliation cluster',
          errorHeading: 'Unable to load reconciliation cluster',
          backHref: '/app/team/reconciliation',
        },
      ];

      for (const { ErrorPage, heading, errorHeading, backHref } of cases) {
        const user = userEvent.setup();
        const reset = vi.fn();

        render(<ErrorPage error={new Error('route failed')} reset={reset} />);

        expect(screen.getAllByRole('heading', { level: 1, name: heading })).toHaveLength(1);
        expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe(backHref);
        expect(screen.getByRole('heading', { level: 2, name: errorHeading })).toBeTruthy();
        expect(
          screen.getByText(
            'No evidence, reconciliation outputs, or workspace records have changed. Check your connection, then try again.',
          ),
        ).toBeTruthy();

        const retry = screen.getByRole('button', { name: 'Try again' });
        retry.focus();
        await user.keyboard(keys);

        expect(reset).toHaveBeenCalledOnce();
        cleanup();
      }
    },
  );
});
