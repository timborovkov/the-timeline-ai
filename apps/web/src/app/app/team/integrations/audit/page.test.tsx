import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { integrationAuditSummary } from '@/app/app/team/integrations/audit/integration-audit-summary';
import { WorkspaceTimezoneProvider } from '@/components/workspace-timezone-context';
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

vi.mock('next/navigation', () => ({
  redirect: fakes.redirect,
  useRouter: () => ({ back: vi.fn() }),
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    calendar: { getCalendarSettings: fakes.getCalendarSettings },
    integrations: { listAudit: fakes.integrationAuditList },
    requireMembership: fakes.requireMembership,
  }),
}));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/db', () => ({ db: {} }));

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
    expect(html).toContain('Jul 14, 2026, 5:30 PM');
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
