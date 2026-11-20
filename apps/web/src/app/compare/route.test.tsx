import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import CompareToolPage, {
  generateMetadata as generateCompareMetadata,
} from '@/app/compare/[slug]/page';
import CompareHubPage, { metadata as compareHubMetadata } from '@/app/compare/page';
import { ComparePage } from '@/components/marketing/compare/compare-page';
import { COMPARE_HUB, COMPARE_PAGES } from '@/components/marketing/compare/content';
import { WORKS_WITH_TOOLS } from '@/components/marketing/integrations/works-with-content';

describe('compare routes', () => {
  it('renders a thin hub of head-to-head pages only', () => {
    const html = renderToStaticMarkup(<CompareHubPage />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('See how The Timeline sits next to other tools.');
    expect(html).toContain(
      'Day AI, Folk, Glean, Geekbot, Suda, MemoryCrow or Achiral alternatives',
    );
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

  it('publishes alternatives-targeted metadata on the hub and seven vs pages', async () => {
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
    expect(html).toContain(`Last reviewed <time dateTime="${page.dates.reviewed}">`);
    const decoded = html.replaceAll('&#x27;', "'");
    for (const fact of page.facts) {
      expect(decoded).toContain(fact.claim);
      expect(html).toContain(`href="${fact.source.href}"`);
    }
  });

  it('shows an independent review date for a single claim', () => {
    const [page] = COMPARE_PAGES;
    if (!page) throw new Error('Expected a comparison page.');
    const html = renderToStaticMarkup(
      <ComparePage
        page={{
          ...page,
          dates: { ...page.dates, reviewed: '2026-11-08' },
          facts: page.facts.map((fact, index) =>
            index === 0 ? { ...fact, reviewedOn: '2026-11-09' } : fact,
          ),
        }}
      />,
    );
    expect(html).toContain('Last reviewed <time dateTime="2026-11-08">November 8, 2026</time>');
    expect(html).toContain('Checked <time dateTime="2026-11-09">November 9, 2026</time>');
    expect(html).toContain('Checked <time dateTime="2026-11-06">November 6, 2026</time>');
  });
});
