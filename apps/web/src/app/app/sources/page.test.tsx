import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  getSourcesStatusSummary: vi.fn(),
  requireMembership: vi.fn(),
}));

vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({ requireMembership: fakes.requireMembership }),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/hub-status', () => ({
  getSourcesStatusSummary: fakes.getSourcesStatusSummary,
}));

const { default: SourcesPage } = await import('./page.js');

beforeEach(() => {
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({
    active: { teamId: 'team-1', teamName: 'Acme Labs' },
  });
  fakes.requireMembership.mockResolvedValue('owner');
  fakes.getSourcesStatusSummary.mockResolvedValue({
    attention: 1,
    inboundEmail: 'acme+archive@inbound.timeline.test',
    emailForwarded: false,
    telegramConnections: 0,
    slackConnections: 0,
    documentsTotal: 0,
    documentAttention: 0,
    meetingsRecent: 0,
    meetingsActive: 0,
    meetingsFailed: 0,
    meetingMinutesUsed: 0,
    nativeIntegrations: 0,
    integrationErrors: 0,
    mcpServers: 0,
    mcpErrors: 0,
  });
});

describe('SourcesPage', () => {
  it('keeps one page heading, the inbound address copy control, and sender-attribution guidance', async () => {
    const html = renderToStaticMarkup(await SourcesPage());

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('acme+archive@inbound.timeline.test');
    expect(html).toContain('Copy address');
    expect(html).toContain('Member email addresses are attributed automatically.');
    expect(html).toContain('Unknown senders are captured and marked unverified.');
  });

  it('keeps source actions contextual and rows responsive for keyboard and narrow-screen use', async () => {
    const html = renderToStaticMarkup(await SourcesPage());

    expect(html).toContain('aria-label="Manage email: Email"');
    expect(html).toContain('aria-label="Install Slack: Slack"');
    expect(html).toContain('min-h-8');
    expect(html).toContain('sm:flex-row sm:items-center sm:gap-3');
    expect(html).toContain('focus-visible:ring-2 focus-visible:ring-signal/50');
    expect(html).toContain('Advanced tools');
    expect(html).not.toContain('rounded-md border border-border bg-surface p-4');
  });

  it('shows administrator tools only to owners and admins', async () => {
    const adminHtml = renderToStaticMarkup(await SourcesPage());
    expect(adminHtml).toContain('Outbound MCP sharing');
    expect(adminHtml).toContain('Integration audit');

    fakes.requireMembership.mockResolvedValue('member');
    const memberHtml = renderToStaticMarkup(await SourcesPage());
    expect(memberHtml).not.toContain('Outbound MCP sharing');
    expect(memberHtml).not.toContain('Integration audit');
    expect(memberHtml).toContain('Provider resources and webhooks');
  });
});
