import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { getConnectorCapabilityTiers } from '@/components/marketing/integrations/connector-content';
import {
  MCP_GUIDE_HOSTED_TOOL_NAMES,
  MCP_GUIDE_LOCAL_TOOL_NAMES,
  MCP_GUIDE_NAV_LABEL,
  MCP_GUIDE_PAGE,
  MCP_GUIDE_RELATED,
  MCP_GUIDE_ROUTE,
  getMcpGuideCatalog,
} from '@/components/marketing/integrations/mcp-guide-content';

describe('MCP guide content', () => {
  it('describes inbound agent tools without inventing native sync or outbound setup', () => {
    const catalog = getMcpGuideCatalog();
    const tiers = getConnectorCapabilityTiers();

    expect(MCP_GUIDE_ROUTE).toBe('/integrations/mcp');
    expect(MCP_GUIDE_NAV_LABEL).toBe('Connect MCP tools');
    expect(MCP_GUIDE_PAGE.route).toBe(MCP_GUIDE_ROUTE);
    expect(catalog.hostedTools).toEqual(tiers.mcpAccess);
    expect(catalog.hostedTools).toEqual([...MCP_GUIDE_HOSTED_TOOL_NAMES]);
    expect(catalog.localDesktopTools).toEqual([...MCP_GUIDE_LOCAL_TOOL_NAMES]);

    const copy = JSON.stringify(MCP_GUIDE_PAGE);
    expect(copy).toMatch(/Connections/);
    expect(copy).toMatch(/Agent tools/);
    expect(copy).toMatch(/\/app\/connections\/agent-tools/);
    expect(copy).toMatch(/\/app\/me\/mcp-servers/);
    expect(copy).toMatch(/None, Bearer token, Custom header, or OAuth/);
    expect(copy).toMatch(/Agent MCP servers list can enable, disable, or remove it/);
    expect(copy).toMatch(/Free plan does not include custom MCP servers/);
    expect(copy).not.toMatch(
      /legacy SSE picker|refresh every|env-file only|paste a URL into \.env/i,
    );
    expect(MCP_GUIDE_PAGE.distinction.outboundBody).toMatch(/Agents page/);
    expect(MCP_GUIDE_PAGE.notNative.body).toMatch(/Sentry/);
    expect(MCP_GUIDE_RELATED.map((item) => item.href)).toEqual([
      '/integrations',
      '/integrations/jira',
      '/integrations/notion',
      '/agents',
      '/help/integrations',
    ]);
  });
});
