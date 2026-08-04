import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    const html = renderToStaticMarkup(await TrustAuditPage());

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
});
