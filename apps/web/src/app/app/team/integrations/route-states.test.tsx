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
  it('announces that the legacy route is opening Connections', () => {
    render(<IntegrationsLoading />);

    expect(screen.getByLabelText('Opening connections')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Opening connections');
    expect(screen.getByRole('heading', { name: 'Team integrations', level: 1 })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Connections' }).getAttribute('href')).toBe(
      '/app/connections',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('announces audit loading outside its busy, route-shaped placeholder', () => {
    render(<IntegrationAuditLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading integration audit');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading integration audit').getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(screen.getAllByRole('heading', { level: 1, name: 'Integration audit' })).toHaveLength(1);
    expect(
      screen.queryByRole('region', { name: 'Integration audit loading placeholder' }),
    ).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])('keeps integrations context and retries safely with $name', async ({ keys }) => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<IntegrationsError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Team integrations' })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Connections' }).getAttribute('href')).toBe(
      '/app/connections',
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Unable to open team integrations' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'This failed redirect did not change your provider connections, shared sources, or sync settings. Check your connection, then try again.',
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
    expect(screen.getByRole('link', { name: 'Connections' }).getAttribute('href')).toBe(
      '/app/connections',
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
