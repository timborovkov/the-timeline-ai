import { describe, expect, it } from 'vitest';

import {
  EDITORIAL_CANONICAL_ROUTES,
  EDITORIAL_GUIDES,
  EDITORIAL_PUBLICATION_NAME,
  RECORD_ROUTE,
} from '@/components/marketing/editorial/content';
import {
  EDITORIAL_PUBLIC_DOCUMENTS,
  findEditorialPublicDocument,
} from '@/components/marketing/editorial/public-documents';
import { buildLlmsFullTxt, buildLlmsTxt } from '@/lib/llms-text';
import { PUBLIC_DOCUMENT_REGISTRY } from '@/lib/public-site';
import { buildPublicSitemap } from '@/lib/public-site/sitemap';

const SITE_URL = 'https://thetimeline.cc';

describe('editorial public documents', () => {
  it('contributes every canonical editorial route to the shared registry', () => {
    expect(EDITORIAL_PUBLIC_DOCUMENTS.documents.map((document) => document.canonicalPath)).toEqual(
      EDITORIAL_CANONICAL_ROUTES,
    );

    for (const route of EDITORIAL_CANONICAL_ROUTES) {
      expect(PUBLIC_DOCUMENT_REGISTRY.get(route)).toBe(findEditorialPublicDocument(route));
    }
  });

  it('publishes the Record and guides through sitemap discovery', () => {
    const urls = buildPublicSitemap(PUBLIC_DOCUMENT_REGISTRY, SITE_URL).map((entry) => entry.url);

    expect(urls).toEqual(
      expect.arrayContaining(
        EDITORIAL_CANONICAL_ROUTES.map((route) => new URL(route, SITE_URL).toString()),
      ),
    );
  });

  it('publishes curated editorial summaries and source boundaries to both LLM documents', () => {
    const compact = buildLlmsTxt({ registry: PUBLIC_DOCUMENT_REGISTRY, siteUrl: SITE_URL });
    const full = buildLlmsFullTxt({ registry: PUBLIC_DOCUMENT_REGISTRY, siteUrl: SITE_URL });

    expect(compact).toContain('## How Timeline works');
    expect(compact).toContain(`[${EDITORIAL_PUBLICATION_NAME}](${SITE_URL}${RECORD_ROUTE})`);
    for (const guide of EDITORIAL_GUIDES) {
      const firstBoundary = guide.boundaries.at(0);
      expect(firstBoundary).toBeDefined();
      if (!firstBoundary) throw new Error(`Guide has no source boundary: ${guide.route}`);

      expect(compact).toContain(`[${guide.title}](${SITE_URL}${guide.route})`);
      expect(full).toContain(`URL: ${SITE_URL}${guide.route}`);
      expect(full).toContain(firstBoundary.boundary);
    }
  });

  it('keeps Article, breadcrumb, and FAQ inputs next to each guide summary', () => {
    for (const guide of EDITORIAL_GUIDES) {
      const document = findEditorialPublicDocument(guide.route);

      expect(document.structuredData.map((input) => input.type)).toEqual([
        'tech-article',
        'breadcrumbs',
        'faq',
      ]);
      expect(document.description).toBe(guide.summary);
      expect(document.capability).toEqual({ kind: 'current-product' });
    }
  });
});
