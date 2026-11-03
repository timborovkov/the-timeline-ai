import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { PRODUCT_TOUR } from '@/components/marketing/product-tour/content';
import { USE_CASE_HUB, USE_CASES } from '@/components/marketing/use-cases/content';
import {
  findUseCasePublicDocument,
  PRODUCT_TOUR_DOCUMENT,
  USE_CASE_PUBLIC_DOCUMENTS,
} from '@/components/marketing/use-cases/public-documents';
import { buildLlmsFullTxt, buildLlmsTxt } from '@/lib/llms-text';
import { PUBLIC_DOCUMENT_REGISTRY } from '@/lib/public-site';
import { buildPublicSitemap } from '@/lib/public-site/sitemap';

const SITE_URL = 'https://thetimeline.cc';

describe('use-case and product-tour public documents', () => {
  it('registers the hub, six use cases, and product tour for sitemap and LLM discovery', () => {
    expect(USE_CASE_PUBLIC_DOCUMENTS.documents.map((document) => document.canonicalPath)).toEqual([
      USE_CASE_HUB.route,
      ...USE_CASES.map((useCase) => useCase.route),
    ]);
    expect(PUBLIC_DOCUMENT_REGISTRY.get(PRODUCT_TOUR.route)).toBe(PRODUCT_TOUR_DOCUMENT);

    const sitemapUrls = buildPublicSitemap(PUBLIC_DOCUMENT_REGISTRY, SITE_URL).map(
      (entry) => entry.url,
    );
    expect(sitemapUrls).toContain(`${SITE_URL}${USE_CASE_HUB.route}`);
    expect(sitemapUrls).toContain(`${SITE_URL}${PRODUCT_TOUR.route}`);

    for (const useCase of USE_CASES) {
      const document = findUseCasePublicDocument(useCase);
      expect(PUBLIC_DOCUMENT_REGISTRY.get(useCase.route)).toBe(document);
      expect(sitemapUrls).toContain(`${SITE_URL}${useCase.route}`);
    }
  });

  it('publishes use-case and tour summaries in both LLM documents', () => {
    const compact = buildLlmsTxt({ registry: PUBLIC_DOCUMENT_REGISTRY, siteUrl: SITE_URL });
    const full = buildLlmsFullTxt({ registry: PUBLIC_DOCUMENT_REGISTRY, siteUrl: SITE_URL });

    expect(compact).toContain('## Use cases');
    expect(compact).toContain(`[Use cases](${SITE_URL}/use-cases)`);
    expect(compact).toContain(`[Product tour](${SITE_URL}/product-tour)`);
    expect(compact).toContain('See it first');
    expect(full).toContain(`URL: ${SITE_URL}/use-cases/work-record`);
  });
});
