import { describe, expect, it } from 'vitest';

import type { PublicDocument } from '@/lib/public-site/types';

import {
  buildPublicStructuredData,
  stringifyJsonLdForHtml,
} from '@/lib/public-site/structured-data';

describe('public structured data', () => {
  it('builds canonical page, article, breadcrumb, and FAQ nodes', () => {
    const graph = buildPublicStructuredData(document(), 'https://thetimeline.cc/deploy');

    expect(graph).toMatchObject({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'TechArticle',
          '@id': 'https://thetimeline.cc/help/capture#webpage',
          url: 'https://thetimeline.cc/help/capture',
          dateModified: '2026-08-05',
          lastReviewed: '2026-08-12',
          datePublished: '2026-08-01',
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            {
              '@type': 'ListItem',
              position: 1,
              name: 'Help',
              item: 'https://thetimeline.cc/help',
            },
          ],
        },
        {
          '@type': 'FAQPage',
          mainEntity: [
            {
              '@type': 'Question',
              name: 'Is it cited?',
              acceptedAnswer: { '@type': 'Answer', text: 'Yes.' },
            },
          ],
        },
      ],
    });
  });

  it('escapes JSON-LD for safe embedding in an HTML script element', () => {
    const serialized = stringifyJsonLdForHtml({
      text: '</script><script>globalThis.evil()</script>&\u2028next',
    });

    expect(serialized).not.toContain('</script>');
    expect(serialized).toContain('\\u003c/script\\u003e');
    expect(serialized).toContain('\\u0026\\u2028');
    expect(JSON.parse(serialized)).toEqual({
      text: '</script><script>globalThis.evil()</script>&\u2028next',
    });
  });
});

function document(): PublicDocument {
  return {
    canonicalPath: '/help/capture',
    kind: 'guide',
    title: 'Capture',
    description: 'Capture work into Timeline.',
    indexability: 'index',
    dates: { modified: '2026-08-05', reviewed: '2026-08-12' },
    capability: { kind: 'current-product' },
    sitemap: { changeFrequency: 'monthly', priority: 0.7 },
    llms: { section: 'product-guides', order: 1, summary: 'Capture work.' },
    structuredData: [
      { type: 'tech-article', published: '2026-08-01', authorName: 'The Timeline' },
      { type: 'breadcrumbs', items: [{ name: 'Help', path: '/help' }] },
      { type: 'faq', entries: [{ question: 'Is it cited?', answer: 'Yes.' }] },
    ],
  };
}
