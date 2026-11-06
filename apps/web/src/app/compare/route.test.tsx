import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import CompareToolPage, {
  generateMetadata as generateCompareMetadata,
} from '@/app/compare/[slug]/page';
import CompareHubPage, { metadata as compareHubMetadata } from '@/app/compare/page';
import { COMPARE_HUB, COMPARE_PAGES } from '@/components/marketing/compare/content';
import { WORKS_WITH_TOOLS } from '@/components/marketing/integrations/works-with-content';

describe('compare routes', () => {
  it('renders a thin hub of head-to-head pages only', () => {
    const html = renderToStaticMarkup(<CompareHubPage />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('See how The Timeline sits next to other tools.');
    expect(html).toContain('Day AI, Folk, Glean or Geekbot alternatives');
    expect(html).toContain('when that tool is the better pick');
    expect(html).toContain('data-compare-hub');
    expect(html).toContain('Start free');
    expect(html).toContain('Head to head');
    expect(html).toContain('href="/integrations"');
    expect(html).not.toContain('Works with');
    for (const page of COMPARE_PAGES) {
      expect(html).toContain(`href="${page.route}"`);
      expect(html).toContain(page.navLabel);
    }
    for (const tool of WORKS_WITH_TOOLS) {
      expect(html).not.toContain(`href="${tool.route}"`);
    }
  });

  it('publishes alternatives-targeted metadata on the hub and four vs pages', async () => {
    expect(compareHubMetadata.title).toBe(COMPARE_HUB.seoTitle);
    expect(compareHubMetadata.description).toBe(COMPARE_HUB.seoDescription);
    expect(compareHubMetadata.alternates).toEqual({ canonical: COMPARE_HUB.route });

    for (const page of COMPARE_PAGES) {
      const metadata = await generateCompareMetadata({
        params: Promise.resolve({ slug: page.slug }),
      });
      expect(metadata.title).toBe(page.seoTitle);
      expect(metadata.description).toBe(page.seoDescription);
      expect(metadata.alternates).toEqual({ canonical: page.route });
    }
  });

  it.each(COMPARE_PAGES)('renders $route with cited competitor facts', async (page) => {
    const html = renderToStaticMarkup(
      await CompareToolPage({ params: Promise.resolve({ slug: page.slug }) }),
    );

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(page.title);
    expect(html).toContain(`${page.name} alternative`);
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
