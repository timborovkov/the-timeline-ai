import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({ back: vi.fn(), reportCaughtError: vi.fn() }));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ back: fakes.back }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportCaughtError: fakes.reportCaughtError }),
  () => import('@/lib/sentry-report'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { default: IntegrationAuditError } = await import('@/app/app/team/integrations/audit/error');
const { default: IntegrationAuditLoading } =
  await import('@/app/app/team/integrations/audit/loading');
const { default: IntegrationsError } = await import('@/app/app/team/integrations/error');
const { default: IntegrationsLoading } = await import('@/app/app/team/integrations/loading');

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

    const retry = screen.getByRole('button', { name: 'Retry' });
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

    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    await user.keyboard(keys);

    expect(reset).toHaveBeenCalledOnce();
  });
});
