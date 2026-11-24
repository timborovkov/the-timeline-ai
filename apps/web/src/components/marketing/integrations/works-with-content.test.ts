import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  WORKS_WITH_PAGE_TOOLS,
  WORKS_WITH_SLUGS,
  WORKS_WITH_TOOLS,
  findWorksWithTool,
  findWorksWithToolByRoute,
} from '@/components/marketing/integrations/works-with-content';

describe('works-with content', () => {
  it('publishes six integrations works-with pages with honest status', () => {
    expect(WORKS_WITH_TOOLS.map((tool) => tool.slug)).toEqual([...WORKS_WITH_SLUGS]);
    expect(WORKS_WITH_SLUGS).not.toContain('google-drive');
    expect(findWorksWithTool('google-drive')).toBeUndefined();
    expect(WORKS_WITH_PAGE_TOOLS.map((tool) => tool.slug)).toEqual([
      'jira',
      'notion',
      'hubspot',
      'attio',
      'pipedrive',
    ]);

    const linear = findWorksWithTool('linear');
    const jira = findWorksWithTool('jira');
    const notion = findWorksWithTool('notion');
    const hubspot = findWorksWithTool('hubspot');
    const attio = findWorksWithTool('attio');
    const pipedrive = findWorksWithTool('pipedrive');
    if (!linear || !jira || !notion || !hubspot || !attio || !pipedrive) {
      throw new Error('Works-with tools are incomplete');
    }

    expect(linear.status).toBe('native-sync');
    expect(linear.today).toMatch(/Native Linear ingest/i);
    expect(jira.status).toBe('coming-soon');
    expect(jira.today).toMatch(/Atlassian retired the endpoint/);
    expect(notion.status).toBe('mcp-lookup');
    expect(notion.today).toMatch(/Notion MCP/i);
    expect(notion.later).toContain('Native Notion capture is unavailable');
    expect(JSON.stringify(notion)).not.toMatch(/planned|coming soon/iu);
    expect(hubspot.status).toBe('coming-soon');
    expect(attio.status).toBe('coming-soon');
    expect(pipedrive.status).toBe('coming-soon');
    expect(hubspot.today).toMatch(/does not sync HubSpot/i);
    expect(attio.later).toMatch(/no built-in Attio lookup/i);
    expect(pipedrive.later).toMatch(/no built-in Pipedrive lookup/i);

    const copy = JSON.stringify(WORKS_WITH_TOOLS);
    expect(copy).not.toMatch(/\bvs\.?\b|switch from/iu);

    expect(hubspot.statusLabel).toBe('Native capture planned');
    expect(jira.statusLabel).toBe('Native capture planned');
    expect(linear.statusLabel).toBe('Native sync');

    for (const tool of WORKS_WITH_TOOLS) {
      expect(tool.navLabel).toBe(`${tool.name} · ${tool.statusLabel}`);
      expect(tool.gettingStarted).toMatch(/may not need/i);
      expect(tool.whenAloneBetter.toLowerCase()).toContain(
        `stay in ${tool.name.toLowerCase()} alone`,
      );
      expect(findWorksWithToolByRoute(tool.route)).toBe(tool);
      expect(tool.route).toBe(`/integrations/${tool.slug}`);
    }
  });
});
