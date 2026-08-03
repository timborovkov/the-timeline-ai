// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ back: vi.fn(), reportCaughtError: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: fakes.back }) }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import IntegrationAuditError from '@/app/app/team/integrations/audit/error';
import IntegrationAuditLoading from '@/app/app/team/integrations/audit/loading';
import IntegrationsError from '@/app/app/team/integrations/error';
import IntegrationsLoading from '@/app/app/team/integrations/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Team integrations route states', () => {
  it.each([
    {
      heading: 'Team integrations',
      loadingLabel: 'Loading team integrations',
      placeholderLabel: 'Team integrations loading placeholder',
      Loading: IntegrationsLoading,
    },
    {
      heading: 'Integration audit',
      loadingLabel: 'Loading integration audit',
      placeholderLabel: 'Integration audit loading placeholder',
      Loading: IntegrationAuditLoading,
      hiddenPlaceholder: true,
    },
  ])(
    'announces $heading loading outside its busy, route-shaped placeholder',
    ({ heading, loadingLabel, placeholderLabel, Loading, hiddenPlaceholder = false }) => {
      render(<Loading />);

      const announcement = screen.getByRole('status');
      expect(announcement.textContent).toBe(loadingLabel);
      expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
      expect(screen.getByLabelText(loadingLabel).getAttribute('aria-busy')).toBe('true');
      expect(screen.getAllByRole('heading', { level: 1, name: heading })).toHaveLength(1);
      const placeholder = screen.queryByRole('region', { name: placeholderLabel });
      expect(placeholder ? !hiddenPlaceholder : hiddenPlaceholder).toBe(true);
      expect(screen.queryByRole('button')).toBeNull();
    },
  );

  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])('keeps integrations context and retries safely with $name', async ({ keys }) => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<IntegrationsError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Team integrations' })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Unable to load team integrations' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Your team’s existing provider connections, shared sources, and sync settings have not changed. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard(keys);

    expect(reset).toHaveBeenCalledOnce();
  });

  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])('keeps audit context and retries safely with $name', async ({ keys }) => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<IntegrationAuditError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Integration audit' })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Integrations' }).getAttribute('href')).toBe(
      '/app/team/integrations',
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Unable to load integration audit' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Your team’s integration activity and audit history have not changed. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard(keys);

    expect(reset).toHaveBeenCalledOnce();
  });
});
