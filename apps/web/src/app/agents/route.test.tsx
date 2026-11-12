import { ADVERTISED_MCP_TOOL_NAMES } from '@timeline/shared/mcp-server';
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import AgentsPage from '@/app/agents/page';
import { AGENTS_HUB } from '@/components/marketing/agents/content';
import { AGENT_SETUP_CARD, TIMELINE_AGENT_SETUP_COMMAND } from '@/components/marketing/copy';
import { TIMELINE_HOSTED_MCP_TOOLS } from '@/lib/agent-install-content';

describe('agents hub', () => {
  it('leads with teammates who report in, plus setup and the MCP read path', () => {
    const html = renderToStaticMarkup(<AgentsPage />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(AGENTS_HUB.title);
    expect(html).toContain(AGENTS_HUB.summary);
    expect(html).toContain(AGENTS_HUB.reportIn.label);
    expect(html).toContain(AGENTS_HUB.readOut.label);
    expect(html).toContain('data-agents-hub');
    expect(html).toContain('data-agent-setup');
    expect(html).toContain('data-claude-mcp-example');
    expect(html).toContain('What did we promise Northstar?');
    expect(html).toContain('data-agent-loop');
    expect(html).not.toContain('data-inbound-mcp');
    expect(html).toContain('href="/integrations/mcp"');
    expect(html).toContain('data-screenshot-file="19-agent-tools-dark.png"');
    expect(html).toContain('data-screenshot-present="true"');
    expect(html).not.toContain('Screenshot placeholder');
    expect(html).toContain(AGENT_SETUP_CARD.title);
    expect(html).toContain(AGENT_SETUP_CARD.body);
    expect(html).toContain(TIMELINE_AGENT_SETUP_COMMAND);
    expect(html).toContain(AGENTS_HUB.readOut.endpoint);
    expect(html).toContain(
      'timeline.search, timeline.get, timeline.subject, timeline.ask, timeline.remember',
    );
    expect(html).toContain('capture is a separate consent checkbox, on by default');
    expect(html).toContain('accepted-sources meter');
    expect(html).toContain('plugins/timeline');
    expect(html).toContain('POST /api/webhooks/ingest');
    expect(html).toContain(`href="${AGENTS_HUB.installGuide.href}"`);
    expect(html).toContain(AGENTS_HUB.example.label);
    expect(html).toContain(AGENTS_HUB.example.title);
    expect(html).toContain(AGENTS_HUB.example.boundary);
    expect(html).toContain('data-agent-setup-prerequisites');
    expect(html).toContain(AGENTS_HUB.setupPrerequisite.title);
    expect(html).toContain(AGENTS_HUB.setupPrerequisite.body);
    expect(html).toContain(AGENTS_HUB.setupPrerequisite.distinction);
    expect(html).toContain(`href="${AGENTS_HUB.setupPrerequisite.mcpHref}"`);
    expect([...TIMELINE_HOSTED_MCP_TOOLS].sort()).toEqual([...ADVERTISED_MCP_TOOL_NAMES].sort());
  });
});
