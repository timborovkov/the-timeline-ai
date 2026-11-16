import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { EDITORIAL_GUIDES, HOW_IT_WORKS_ROUTE } from '@/components/marketing/editorial/content';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import {
  buildGuideStructuredData,
  buildGuidesStructuredData,
  createGuidesMetadata,
  buildHowItWorksStructuredData,
  createGuideMetadata,
  createHowItWorksMetadata,
} from '@/components/marketing/editorial/metadata';
describe('editorial metadata', () => {
  it('publishes the guides collection with canonical metadata and all articles', () => {
    const metadata = createGuidesMetadata();
    expect(metadata.alternates).toEqual({ canonical: '/guides' });
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
    const graph = buildGuidesStructuredData()['@graph'];
    const collection = graph.find((node) => node['@type'] === 'CollectionPage');
    expect(collection?.hasPart).toHaveLength(7);
    for (const guide of EDITORIAL_GUIDES) {
      const articleGraph = buildGuideStructuredData(guide)['@graph'];
      const article = articleGraph.find((node) => node['@type'] === 'TechArticle');
      expect(article?.isPartOf).toMatchObject({ name: 'Guides' });
      expect(JSON.stringify(article?.isPartOf)).toContain('/guides#webpage');
      const breadcrumb = articleGraph.find((node) => node['@type'] === 'BreadcrumbList');
      expect(breadcrumb?.itemListElement).toMatchObject([
        { name: 'Home' },
        { name: 'Guides' },
        { name: guide.shortTitle },
      ]);
    }
  });

  it('publishes canonical index metadata', () => {
    const metadata = createHowItWorksMetadata();

    const description =
      'See how The Timeline retrieves cited evidence from conversations and documents, balances relevance with freshness, and distinguishes accepted records from pending changes. Newer evidence does not automatically overwrite the record.';
    expect(metadata.description).toBe(description);
    expect(metadata.alternates).toEqual({ canonical: HOW_IT_WORKS_ROUTE });
    expect(metadata.openGraph).toMatchObject({
      description,
      type: 'website',
      url: HOW_IT_WORKS_ROUTE,
    });
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });

  it.each(EDITORIAL_GUIDES)('publishes Article metadata for $route', (guide) => {
    const metadata = createGuideMetadata(guide);

    expect(metadata.title).toBe(guide.title);
    expect(metadata.description).toBe(guide.summary);
    expect(metadata.alternates).toEqual({ canonical: guide.route });
    expect(metadata.openGraph).toMatchObject({ type: 'article', url: guide.route });
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });

  it('builds CollectionPage and BreadcrumbList data for the publication', () => {
    const html = renderToStaticMarkup(
      <EditorialStructuredData data={buildHowItWorksStructuredData()} />,
    );

    expect(html).toContain('application/ld+json');
    expect(html).toContain('"@type":"CollectionPage"');
    expect(html).toContain('"@type":"BreadcrumbList"');
    expect(html).toContain('"hasPart"');
  });

  it.each(EDITORIAL_GUIDES)(
    'builds TechArticle, BreadcrumbList, and FAQ data for $route',
    (guide) => {
      const html = renderToStaticMarkup(
        <EditorialStructuredData data={buildGuideStructuredData(guide)} />,
      );

      expect(html).toContain('"@type":"TechArticle"');
      expect(html).toContain('"@type":"BreadcrumbList"');
      expect(html).toContain('"@type":"FAQPage"');
      expect(html).toContain(guide.title);
      expect(html).toContain(guide.route);
    },
  );
});
