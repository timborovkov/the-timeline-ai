// @vitest-environment happy-dom

// The audit route is admin-only, so its loading and recovery states must retain
// the safe team context without suggesting that audit data changed or leaked.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ back: vi.fn(), reportCaughtError: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: fakes.back }) }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import IntegrationAuditError from '@/app/app/team/integrations/audit/error';
import IntegrationAuditLoading from '@/app/app/team/integrations/audit/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Integration audit route states', () => {
  it('announces a quiet loading state while preserving team navigation outside the inert visual placeholder', () => {
    render(<IntegrationAuditLoading />);

    expect(screen.getByRole('status').textContent).toBe('Loading integration audit');
    expect(screen.getByRole('status').parentElement?.getAttribute('aria-busy')).toBeNull();

    const loadingState = screen.getByLabelText('Loading integration audit');
    expect(loadingState.getAttribute('aria-busy')).toBe('true');
    expect(loadingState.className).toContain('motion-reduce:[&_.animate-pulse]:animate-none');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Integration audit' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Team' }).getAttribute('href')).toBe('/app/team');
    expect(screen.getByRole('link', { name: 'Integrations' }).getAttribute('href')).toBe(
      '/app/team/integrations',
    );

    const visualPlaceholder = loadingState.querySelector('[inert][aria-hidden="true"]');
    expect(visualPlaceholder).toBeTruthy();
    expect(visualPlaceholder?.querySelectorAll('a, button, input, select, textarea')).toHaveLength(
      0,
    );
  });

  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])('retains safe audit context and retries with $name', async ({ keys }) => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<IntegrationAuditError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Integration audit' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Team' }).getAttribute('href')).toBe('/app/team');
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

    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    await user.keyboard(keys);

    expect(reset).toHaveBeenCalledOnce();
  });
});
