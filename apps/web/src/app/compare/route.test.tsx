import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import CompareToolPage from '@/app/compare/[slug]/page';
import CompareHubPage from '@/app/compare/page';
import { COMPARE_PAGES } from '@/components/marketing/compare/content';
import { WORKS_WITH_TOOLS } from '@/components/marketing/integrations/works-with-content';

describe('compare routes', () => {
  it('renders the hub with head-to-head and works-with cards', () => {
    const html = renderToStaticMarkup(<CompareHubPage />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('See how The Timeline sits next to other tools.');
    expect(html).toContain('data-compare-hub');
    expect(html).toContain('Start free');
    expect(html).toContain('Head to head');
    expect(html).toContain('Works with');
    for (const page of COMPARE_PAGES) {
      expect(html).toContain(`href="${page.route}"`);
      expect(html).toContain(page.navLabel);
    }
    for (const tool of WORKS_WITH_TOOLS) {
      expect(html).toContain(`href="${tool.route}"`);
      expect(html).toContain(tool.name);
    }
  });

  it.each(COMPARE_PAGES)('renders $route with cited competitor facts', async (page) => {
    const html = renderToStaticMarkup(
      await CompareToolPage({ params: Promise.resolve({ slug: page.slug }) }),
    );

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(page.title);
    expect(html).toContain('Start free');
    expect(html).toContain(`data-compare-route="${page.route}"`);
    expect(html).toContain(`When ${page.name} is the better pick`);
    const decoded = html.replaceAll('&#x27;', "'");
    for (const fact of page.facts) {
      expect(decoded).toContain(fact.claim);
      expect(html).toContain(`href="${fact.source.href}"`);
    }
  });
});
