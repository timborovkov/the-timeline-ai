import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  getCalendarSettings: vi.fn(),
  integrationAuditList: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  requireMembership: vi.fn(),
  resolveActiveTeam: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    redirect: fakes.redirect,
    useRouter: () => ({ back: vi.fn() }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      calendar: { getCalendarSettings: fakes.getCalendarSettings },
      integrations: { listAudit: fakes.integrationAuditList },
      requireMembership: fakes.requireMembership,
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({ resolveActiveTeam: fakes.resolveActiveTeam }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.auth }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);

const { renderToStaticMarkup } = await import('react-dom/server');
const { integrationAuditSummary } =
  await import('@/app/app/team/integrations/audit/integration-audit-summary');
const { WorkspaceTimezoneProvider } = await import('@/components/workspace-timezone-context');

const { default: IntegrationAuditPage } = await import('@/app/app/team/integrations/audit/page');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({
    active: { teamId: 'team-1', teamName: 'Acme Labs' },
  });
  fakes.requireMembership.mockResolvedValue('admin');
  fakes.getCalendarSettings.mockResolvedValue({ defaultTimezone: 'America/Los_Angeles' });
  fakes.integrationAuditList.mockResolvedValue([
    {
      id: 'audit-1',
      kind: 'webhook_provision_failed',
      payload: { provider: 'github', error: 'Refresh token was revoked' },
      createdAt: new Date('2026-07-15T00:30:00.000Z'),
    },
  ]);
});

describe('IntegrationAuditPage', () => {
  it('presents audit times in the team timezone with clear timezone context', async () => {
    const html = renderToStaticMarkup(
      <WorkspaceTimezoneProvider timezone="America/Los_Angeles">
        {await IntegrationAuditPage()}
      </WorkspaceTimezoneProvider>,
    );

    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(fakes.integrationAuditList).toHaveBeenCalledWith(null, 200);
    expect(fakes.getCalendarSettings).toHaveBeenCalledOnce();
    expect(html).toContain(
      new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(new Date('2026-07-14T17:30:00.000Z')),
    );
    expect(html).toContain('America/Los_Angeles');
    expect(html).toContain('times in America/Los_Angeles');
    expect(html).toContain('dateTime="2026-07-15T00:30:00.000Z"');
  });

  it('keeps technical event codes and payload values inside the disclosure', async () => {
    const html = renderToStaticMarkup(await IntegrationAuditPage());
    const primaryContent = html.replace(/<details[\s\S]*?<\/details>/g, '');

    expect(primaryContent).toContain('Webhook setup failed');
    expect(primaryContent).not.toContain('webhook_provision_failed');
    expect(primaryContent).not.toContain('Refresh token was revoked');
    expect(html).toContain('Event code');
    expect(html).toContain('webhook_provision_failed');
  });

  it('gives an empty integration audit a named, explanatory archive state', async () => {
    fakes.integrationAuditList.mockResolvedValueOnce([]);

    const html = renderToStaticMarkup(await IntegrationAuditPage());

    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('aria-labelledby="integration-audit-entries"');
    expect(html).toContain('id="integration-audit-entries"');
    expect(html).toContain('No integration audit entries yet');
    expect(html).toContain(
      'Connection and sync activity that creates an audit record will appear here.',
    );
    expect(html).toContain('href="/app/team/integrations"');
    expect(html).toContain('Manage integrations');
  });
});

describe('integrationAuditSummary', () => {
  it('keeps new audit event codes readable without dropping the code from technical details', () => {
    expect(integrationAuditSummary('provider:sync_complete')).toBe('Provider sync complete');
  });
});
