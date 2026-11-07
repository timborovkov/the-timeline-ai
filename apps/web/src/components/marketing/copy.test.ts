import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { INTEGRATION_NAV_ITEMS } from '@/components/marketing/copy';
import { CONNECTORS, findConnector } from '@/components/marketing/integrations/connector-content';
import {
  MCP_GUIDE_NAV_LABEL,
  MCP_GUIDE_ROUTE,
} from '@/components/marketing/integrations/mcp-guide-content';
import { TELEGRAM_PAGE } from '@/components/marketing/integrations/telegram-content';
import { WORKS_WITH_TOOLS } from '@/components/marketing/integrations/works-with-content';

describe('public marketing copy', () => {
  it('lists live native and capture Integrations destinations with a general MCP guide', () => {
    expect(INTEGRATION_NAV_ITEMS.map((item) => item.label)).toEqual([
      'Slack',
      'Telegram',
      'Google Drive',
      'GitHub',
      'Linear',
      'Monday.com',
      'Sentry',
      MCP_GUIDE_NAV_LABEL,
    ]);
    expect(INTEGRATION_NAV_ITEMS.map((item) => item.href)).toEqual([
      '/integrations/slack',
      TELEGRAM_PAGE.route,
      '/integrations/google-drive',
      '/integrations/github',
      '/integrations/linear',
      '/integrations/monday',
      '/integrations/sentry',
      MCP_GUIDE_ROUTE,
    ]);
    expect(INTEGRATION_NAV_ITEMS.every((item) => !item.label.includes('·'))).toBe(true);
    expect(
      INTEGRATION_NAV_ITEMS.some((item) => /native sync|capture|mcp lookup/i.test(item.label)),
    ).toBe(false);

    const comingSoonRoutes = WORKS_WITH_TOOLS.filter((tool) => tool.status === 'coming-soon').map(
      (tool) => tool.route,
    );
    expect(comingSoonRoutes).toEqual([
      '/integrations/hubspot',
      '/integrations/attio',
      '/integrations/pipedrive',
    ]);
    const navHrefs = new Set<string>(INTEGRATION_NAV_ITEMS.map((item) => item.href));
    for (const route of comingSoonRoutes) {
      expect(navHrefs.has(route)).toBe(false);
    }
    expect(navHrefs.has('/integrations/jira')).toBe(false);
    expect(navHrefs.has('/integrations/notion')).toBe(false);

    for (const connector of CONNECTORS) {
      const item = INTEGRATION_NAV_ITEMS.find(
        (navItem) => navItem.href === `/integrations/${connector.slug}`,
      );
      expect(item?.label).toBe(connector.name);
    }

    for (const slug of ['slack', 'google-drive', 'github', 'monday', 'sentry'] as const) {
      const connector = findConnector(slug);
      if (!connector) throw new Error(`expected ${slug} connector`);
      expect(CONNECTORS.some((entry) => entry.slug === slug)).toBe(true);
    }

    const telegramNav = INTEGRATION_NAV_ITEMS.find((item) => item.href === TELEGRAM_PAGE.route);
    expect(telegramNav).toEqual({
      href: TELEGRAM_PAGE.route,
      label: 'Telegram',
    });
    expect(TELEGRAM_PAGE.summary).toMatch(/Link a Telegram group or DM/i);

    const mcpNav = INTEGRATION_NAV_ITEMS.find((item) => item.href === MCP_GUIDE_ROUTE);
    expect(mcpNav).toEqual({
      href: MCP_GUIDE_ROUTE,
      label: MCP_GUIDE_NAV_LABEL,
      group: 'agent-tools',
    });
  });
});
