import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EDITORIAL_GUIDES, HOW_IT_WORKS_ROUTE } from '@/components/marketing/editorial/content';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import {
  buildGuideStructuredData,
  buildHowItWorksStructuredData,
  createGuideMetadata,
  createHowItWorksMetadata,
} from '@/components/marketing/editorial/metadata';

describe('editorial metadata', () => {
  it('publishes canonical index metadata', () => {
    const metadata = createHowItWorksMetadata();

    const description =
      'See how Timeline preserves selected work as an evidence-backed chronology, answers with citations, and keeps durable changes human-approved.';
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
