import { ADVERTISED_MCP_TOOL_NAMES } from '@timeline/shared/mcp-server';
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import AgentsPage from '@/app/agents/page';
import { TIMELINE_AGENT_SETUP_COMMAND } from '@/components/marketing/copy';
import { TIMELINE_HOSTED_MCP_TOOLS } from '@/lib/agent-install-content';

describe('agents hub', () => {
  it('renders the give-this-to-your-agent box and MCP facts', () => {
    const html = renderToStaticMarkup(<AgentsPage />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Give this to your agent');
    expect(html).toContain('data-agents-hub');
    expect(html).toContain('data-agent-setup');
    expect(html).toContain(TIMELINE_AGENT_SETUP_COMMAND);
    expect(html).toContain('https://thetimeline.cc/api/mcp/server');
    expect(html).toContain(
      'timeline.search, timeline.get, timeline.subject, timeline.ask, timeline.remember',
    );
    expect(html).toContain('capture checkbox, on by default');
    expect(html).toContain('accepted-sources meter');
    expect(html).toContain('plugins/timeline');
    expect(html).toContain('POST /api/webhooks/ingest');
    expect(html).toContain('href="/help/agents"');
    expect([...TIMELINE_HOSTED_MCP_TOOLS].sort()).toEqual([...ADVERTISED_MCP_TOOL_NAMES].sort());
  });
});
