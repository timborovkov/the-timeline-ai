import { describe, expect, it } from 'vitest';

import { SOLUTION_CANONICAL_ROUTES, SOLUTIONS } from '@/components/marketing/solutions/content';
import {
  findSolutionPublicDocument,
  SOLUTION_PUBLIC_DOCUMENTS,
} from '@/components/marketing/solutions/public-documents';
import { buildLlmsFullTxt, buildLlmsTxt } from '@/lib/llms-text';
import {
  buildPublicSitemap,
  buildPublicStructuredData,
  PUBLIC_DOCUMENT_REGISTRY,
} from '@/lib/public-site';

const SITE_URL = 'https://thetimeline.cc';

describe('solution public documents', () => {
  it('registers every solution with its exact metadata and sitemap settings', () => {
    expect(SOLUTION_PUBLIC_DOCUMENTS.documents.map((document) => document.canonicalPath)).toEqual(
      SOLUTION_CANONICAL_ROUTES,
    );

    const sitemapUrls = buildPublicSitemap(PUBLIC_DOCUMENT_REGISTRY, SITE_URL).map(
      (entry) => entry.url,
    );

    for (const solution of SOLUTIONS) {
      const document = findSolutionPublicDocument(solution);

      expect(PUBLIC_DOCUMENT_REGISTRY.get(solution.route)).toBe(document);
      expect(document).toMatchObject({
        kind: 'solution',
        title: solution.seoTitle,
        description: solution.seoDescription,
        indexability: 'index',
        dates: { modified: '2026-08-21', reviewed: '2026-08-21' },
        capability: { kind: 'current-product' },
        sitemap: { changeFrequency: 'monthly', priority: 0.8 },
      });
      expect(sitemapUrls).toContain(`${SITE_URL}${solution.route}`);
    }
  });

  it('publishes solution summaries and capability boundaries in both LLM documents', () => {
    const compact = buildLlmsTxt({ registry: PUBLIC_DOCUMENT_REGISTRY, siteUrl: SITE_URL });
    const full = buildLlmsFullTxt({ registry: PUBLIC_DOCUMENT_REGISTRY, siteUrl: SITE_URL });

    expect(compact).toContain('## Solutions');
    for (const solution of SOLUTIONS) {
      expect(compact).toContain(
        `[${solution.shortTitle}](${SITE_URL}${solution.route}): ${solution.seoDescription}`,
      );
      expect(full).toContain(`URL: ${SITE_URL}${solution.route}`);
      expect(full).toContain(solution.limitations[0]);
    }
  });

  it('emits visible FAQs and names the product entity explicitly', () => {
    for (const solution of SOLUTIONS) {
      const graph = buildPublicStructuredData(findSolutionPublicDocument(solution), SITE_URL);
      const application = graph['@graph'].find((node) => node['@type'] === 'SoftwareApplication');
      const faq = graph['@graph'].find((node) => node['@type'] === 'FAQPage');

      expect(application).toMatchObject({
        '@type': 'SoftwareApplication',
        name: 'The Timeline',
        url: `${SITE_URL}${solution.route}`,
      });
      expect(faq).toMatchObject({
        '@type': 'FAQPage',
        mainEntity: solution.faqs.map((entry) => ({
          '@type': 'Question',
          name: entry.question,
          acceptedAnswer: { '@type': 'Answer', text: entry.answer },
        })),
      });
    }
  });
});
