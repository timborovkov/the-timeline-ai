import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { INTEGRATION_NAV_ITEMS, publicNavItemLabel } from '@/components/marketing/copy';
import { CONNECTORS, findConnector } from '@/components/marketing/integrations/connector-content';
import { TELEGRAM_PAGE } from '@/components/marketing/integrations/telegram-content';
import { WORKS_WITH_TOOLS } from '@/components/marketing/integrations/works-with-content';

describe('public marketing copy', () => {
  it('lists live Integrations dropdown destinations, not coming-soon tools', () => {
    expect(INTEGRATION_NAV_ITEMS.map((item) => `${item.label} · ${item.statusLabel}`)).toEqual([
      'Slack · Native sync',
      'Telegram · Capture',
      'Google Drive · Native sync',
      'GitHub · Native sync',
      'Linear · Native sync',
      'Monday.com · Native sync',
      'Jira · MCP lookup',
      'Notion · MCP lookup',
    ]);
    expect(INTEGRATION_NAV_ITEMS.map((item) => item.href)).toEqual([
      '/integrations/slack',
      TELEGRAM_PAGE.route,
      '/integrations/google-drive',
      '/integrations/github',
      '/integrations/linear',
      '/integrations/monday',
      '/integrations/jira',
      '/integrations/notion',
    ]);

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
    expect(INTEGRATION_NAV_ITEMS.some((item) => item.statusLabel === 'Coming soon')).toBe(false);

    for (const slug of ['slack', 'google-drive', 'github', 'monday'] as const) {
      const connector = findConnector(slug);
      if (!connector) throw new Error(`expected ${slug} connector`);
      const item = INTEGRATION_NAV_ITEMS.find(
        (navItem) => navItem.href === `/integrations/${slug}`,
      );
      expect(item?.label).toBe(connector.name);
      expect(item?.statusLabel).toBe('Native sync');
      expect(CONNECTORS.some((entry) => entry.slug === slug)).toBe(true);
    }

    const telegramNav = INTEGRATION_NAV_ITEMS.find((item) => item.href === TELEGRAM_PAGE.route);
    expect(telegramNav).toEqual({
      href: TELEGRAM_PAGE.route,
      label: 'Telegram',
      statusLabel: 'Capture',
    });
    expect(publicNavItemLabel({ label: 'Telegram', statusLabel: 'Capture' })).toBe(
      'Telegram · Capture',
    );
    expect(TELEGRAM_PAGE.summary).toMatch(/Link a Telegram group or DM/i);
  });
});
