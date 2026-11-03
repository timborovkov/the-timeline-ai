import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  COMPARE_HUB,
  COMPARE_TOOLS,
  findCompareTool,
  findCompareToolByRoute,
} from '@/components/marketing/compare/content';
import { COMPARE_NAV_ITEMS } from '@/components/marketing/copy';

describe('compare content', () => {
  it('publishes a works-with hub without vs or switch language', () => {
    expect(COMPARE_HUB.route).toBe('/compare');
    expect(COMPARE_TOOLS).toHaveLength(4);
    expect(COMPARE_NAV_ITEMS.map((item) => item.href)).toEqual(
      COMPARE_TOOLS.map((tool) => tool.route),
    );

    const copy = JSON.stringify({ hub: COMPARE_HUB, tools: COMPARE_TOOLS });
    expect(copy).not.toMatch(/\bvs\.?\b|switch from/iu);

    for (const tool of COMPARE_TOOLS) {
      expect(findCompareTool(tool.slug)).toBe(tool);
      expect(findCompareToolByRoute(tool.route)).toBe(tool);
    }
  });

  it('states current Linear sync, Jira MCP lookup, and HubSpot coming soon', () => {
    const linear = findCompareTool('linear');
    const jira = findCompareTool('jira');
    const hubspot = findCompareTool('hubspot');
    const notion = findCompareTool('notion');
    if (!linear || !jira || !hubspot || !notion) throw new Error('Compare tools are incomplete');

    expect(linear.today).toMatch(/native Linear integration/i);
    expect(jira.today).toMatch(/Atlassian MCP/i);
    expect(hubspot.later).toMatch(/HubSpot, Attio and Pipedrive/i);
    expect(notion.today).toMatch(/Notion MCP/i);
  });
});
