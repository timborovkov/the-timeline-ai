import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import ConnectMcpToolsPage, { metadata } from '@/app/integrations/mcp/page';
import { MCP_GUIDE_PAGE } from '@/components/marketing/integrations/mcp-guide-content';
import { resetPublicSessionCache, setPublicSessionCache } from '@/lib/public-session';

function visibleText(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gu, '').replace(/<[^>]+>/gu, '');
}

const { cleanup, render, screen } = await import('@testing-library/react');

describe('Connect MCP tools route', () => {
  afterEach(() => {
    cleanup();
    resetPublicSessionCache();
  });

  it('renders a source-true inbound MCP guide distinct from /agents', () => {
    const html = renderToStaticMarkup(<ConnectMcpToolsPage />);
    const text = visibleText(html);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('data-mcp-guide');
    expect(html).toContain(MCP_GUIDE_PAGE.title);
    expect(text).toContain(MCP_GUIDE_PAGE.distinction.inboundTitle);
    expect(text).toContain(MCP_GUIDE_PAGE.distinction.outboundTitle);
    expect(text).toContain('Notion, Jira, Confluence, and Stripe');
    expect(text).toContain('Figma');
    expect(text).toContain('not connectable from hosted Timeline');
    expect(html).toContain('href="/agents"');
    expect(html).toContain('data-inbound-mcp');
    expect(html).not.toContain('data-agent-loop');
    expect(html).toContain('data-screenshot-file="19-agent-tools-dark.png"');
    expect(html).toContain('data-screenshot-present="true"');
    expect(html).not.toContain('Screenshot placeholder');
    expect(html).toContain('href="/integrations/jira"');
    expect(html).toContain('href="/integrations/notion"');
    expect(text).toContain('Connections');
    expect(text).toContain('Agent tools');
    expect(text).toContain('Agent MCP servers');
    expect(text).not.toMatch(/native Jira ingest is live|silently sync Notion history/i);
    expect(metadata.alternates).toEqual({ canonical: '/integrations/mcp' });
    expect(metadata.title).toBe(MCP_GUIDE_PAGE.seoTitle);
  });

  it('routes signed-in visitors to the shipped Agent tools and personal MCP screens', () => {
    setPublicSessionCache({ status: 'signed-in' });
    render(<ConnectMcpToolsPage />);

    for (const link of screen.getAllByRole('link', { name: MCP_GUIDE_PAGE.setup.teamLabel })) {
      expect(link.getAttribute('href')).toBe(MCP_GUIDE_PAGE.setup.teamHref);
    }
    expect(
      screen.getByRole('link', { name: MCP_GUIDE_PAGE.setup.personalLabel }).getAttribute('href'),
    ).toBe(MCP_GUIDE_PAGE.setup.personalHref);
  });
});
