import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceTimezoneProvider } from '@/components/workspace-timezone-context';

const fakes = vi.hoisted(() => ({
  auditList: vi.fn(),
  auth: vi.fn(),
  getCalendarSettings: vi.fn(),
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
    audit: { list: fakes.auditList },
    calendar: { getCalendarSettings: fakes.getCalendarSettings },
    requireMembership: fakes.requireMembership,
  }),
}));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/db', () => ({ db: {} }));

const { default: TrustAuditPage } = await import('./page.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({
    active: { teamId: 'team-1', teamName: 'Acme Labs' },
  });
  fakes.requireMembership.mockResolvedValue('admin');
  fakes.getCalendarSettings.mockResolvedValue({ defaultTimezone: 'America/Los_Angeles' });
  fakes.auditList.mockResolvedValue([
    {
      id: 'audit-1',
      action: 'settings.change',
      targetType: 'team_settings',
      targetId: null,
      targetLabel: 'team settings',
      redacted: false,
      actor: { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' },
      metadata: {},
      createdAt: new Date('2026-07-15T00:30:00.000Z'),
    },
  ]);
});

describe('TrustAuditPage', () => {
  it('presents audit times in the team timezone with clear timezone context', async () => {
    const html = renderToStaticMarkup(
      <WorkspaceTimezoneProvider timezone="America/Los_Angeles">
        {await TrustAuditPage()}
      </WorkspaceTimezoneProvider>,
    );

    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(fakes.auditList).toHaveBeenCalledWith(200);
    expect(fakes.getCalendarSettings).toHaveBeenCalledOnce();
    expect(html).toContain('Jul 14, 2026, 5:30 PM');
    expect(html).toContain('America/Los_Angeles');
    expect(html).toContain('times in America/Los_Angeles');
    expect(html).toContain('dateTime="2026-07-15T00:30:00.000Z"');
  });

  it('gives an empty audit log a named, explanatory archive state', async () => {
    fakes.auditList.mockResolvedValueOnce([]);

    const html = renderToStaticMarkup(await TrustAuditPage());

    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('aria-labelledby="trust-audit-entries"');
    expect(html).toContain('id="trust-audit-entries"');
    expect(html).toContain('No audit entries yet');
    expect(html).toContain('Team activity that creates an audit record will appear here.');
    expect(html).toContain('href="/app/team"');
    expect(html).toContain('Manage team settings');
  });

  it('leads with a readable audit summary while preserving event codes in technical details', async () => {
    const html = renderToStaticMarkup(await TrustAuditPage());
    const primaryContent = html.replace(/<details[\s\S]*?<\/details>/g, '');

    expect(primaryContent).toContain('Team settings changed');
    expect(primaryContent).toContain('team settings');
    expect(primaryContent).not.toContain('settings.change');
    expect(html).toContain('Event code');
    expect(html).toContain('settings.change');
    expect(html).toContain('sm:grid-cols-[minmax(0,1fr)_minmax(10rem,18rem)]');
    expect(html).toContain('sm:col-span-2');
  });

  it('makes rejected and failed audit outcomes prominent without exposing raw codes', async () => {
    fakes.auditList.mockResolvedValue([
      {
        id: 'audit-rejected',
        action: 'team.export_download',
        targetType: 'team_export',
        targetId: null,
        targetLabel: 'team export',
        redacted: false,
        actor: { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' },
        metadata: { outcome: 'rejected', reason: 'forbidden' },
        createdAt: new Date('2026-07-15T00:30:00.000Z'),
      },
      {
        id: 'audit-failed',
        action: 'team.export_create',
        targetType: 'team_export',
        targetId: null,
        targetLabel: 'team export',
        redacted: false,
        actor: { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' },
        metadata: { outcome: 'enqueue_failed' },
        createdAt: new Date('2026-07-15T00:29:00.000Z'),
      },
      {
        id: 'audit-queued',
        action: 'team.export_create',
        targetType: 'team_export',
        targetId: null,
        targetLabel: 'team export',
        redacted: false,
        actor: { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' },
        metadata: { outcome: 'queued' },
        createdAt: new Date('2026-07-15T00:28:00.000Z'),
      },
    ]);

    const html = renderToStaticMarkup(await TrustAuditPage());
    const primaryContent = html.replace(/<details[\s\S]*?<\/details>/g, '');

    expect(primaryContent).toContain('Team export download rejected');
    expect(primaryContent).toContain('Unable to queue team export');
    expect(primaryContent).toContain('Team export queued');
    expect(primaryContent).not.toContain('Team export completed');
    expect(primaryContent).toContain('Rejected');
    expect(primaryContent).toContain('Failed');
    expect(primaryContent).toContain('text-danger');
    expect(primaryContent).not.toContain('team.export_download');
    expect(primaryContent).not.toContain('team.export_create');
    expect(html).toContain('team.export_download');
    expect(html).toContain('team.export_create');
    expect(html).toContain('enqueue_failed');
  });

  it('keeps curated outcome context in technical details without leaking redacted activity', async () => {
    fakes.auditList.mockResolvedValue([
      {
        id: 'audit-rejected',
        action: 'document.detail_read',
        targetType: 'document',
        targetId: 'redacted-target-id',
        targetLabel: 'Confidential customer plan',
        redacted: true,
        actor: { id: 'user-1', name: 'Private document owner', email: 'owner@example.com' },
        metadata: {
          mode: 'redacted-mode',
          outcome: 'enqueue_failed',
          reason: 'redacted-reason',
          recovery_kind: 'redacted-recovery',
          artifact_kind: 'redacted-artifact',
          target_count: 91,
          expires_at: '2099-01-01T00:00:00.000Z',
          arbitrary_metadata: 'must not render',
          target_ids: ['must-not-render'],
        },
        createdAt: new Date('2026-07-15T00:30:00.000Z'),
      },
      {
        id: 'audit-signed',
        action: 'team.export_download',
        targetType: 'team_export',
        targetId: null,
        targetLabel: 'team export',
        redacted: false,
        actor: { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' },
        metadata: { outcome: 'signed', expires_at: '2026-07-16T00:30:00.000Z' },
        createdAt: new Date('2026-07-15T00:29:00.000Z'),
      },
      {
        id: 'audit-recovery',
        action: 'job.retry',
        targetType: 'job_recovery_batch',
        targetId: null,
        targetLabel: 'job recovery batch',
        redacted: false,
        actor: { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' },
        metadata: {
          mode: 'bulk',
          outcome: 'rejected',
          reason: 'operation_failed',
          recovery_kind: 'integration_sync',
          artifact_kind: 'connection',
          target_count: 3,
          target_ids: ['must-not-render'],
        },
        createdAt: new Date('2026-07-15T00:28:00.000Z'),
      },
    ]);

    const html = renderToStaticMarkup(await TrustAuditPage());

    expect(html).toContain('Reason');
    expect(html).toContain('operation_failed');
    expect(html).toContain('Expires at');
    expect(html).toContain('2026-07-16T00:30:00.000Z');
    expect(html).toContain('Recovery kind');
    expect(html).toContain('integration_sync');
    expect(html).toContain('Artifact kind');
    expect(html).toContain('connection');
    expect(html).toContain('Target count');
    expect(html).toContain('>3<');
    expect(html).toContain('Restricted activity');
    expect(html).toContain('Restricted');
    expect(html).not.toContain('Document viewed');
    expect(html).not.toContain('document.detail_read');
    expect(html).not.toContain('Confidential customer plan');
    expect(html).not.toContain('Private document owner');
    expect(html).not.toContain('owner@example.com');
    expect(html).not.toContain('>document<');
    expect(html).not.toContain('enqueue_failed');
    expect(html).not.toContain('redacted-mode');
    expect(html).not.toContain('redacted-reason');
    expect(html).not.toContain('redacted-recovery');
    expect(html).not.toContain('redacted-artifact');
    expect(html).not.toContain('2099-01-01T00:00:00.000Z');
    expect(html).not.toContain('>91<');
    expect(html).not.toContain('arbitrary_metadata');
    expect(html).not.toContain('must not render');
    expect(html).not.toContain('must-not-render');
    expect(html).not.toContain('redacted-target-id');
  });

  it('does not repeat an email when it is the only available actor label', async () => {
    fakes.auditList.mockResolvedValue([
      {
        id: 'audit-email-only',
        action: 'settings.change',
        targetType: 'team_settings',
        targetId: null,
        targetLabel: 'team settings',
        redacted: false,
        actor: { id: 'user-1', name: null, email: 'ada@example.com' },
        metadata: {},
        createdAt: new Date('2026-07-15T00:30:00.000Z'),
      },
    ]);

    const html = renderToStaticMarkup(await TrustAuditPage());

    expect(html.match(/ada@example\.com/g)).toHaveLength(1);
    expect(html).not.toContain('<dt class="sr-only">Email</dt>');
  });
});
