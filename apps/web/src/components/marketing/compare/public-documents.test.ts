import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { COMPARE_HUB, COMPARE_TOOLS } from '@/components/marketing/compare/content';
import {
  COMPARE_PUBLIC_DOCUMENTS,
  findCompareHubDocument,
  findComparePublicDocument,
} from '@/components/marketing/compare/public-documents';
import { buildLlmsFullTxt, buildLlmsTxt } from '@/lib/llms-text';
import { PUBLIC_DOCUMENT_REGISTRY } from '@/lib/public-site';
import { buildPublicSitemap } from '@/lib/public-site/sitemap';

const SITE_URL = 'https://thetimeline.cc';

describe('compare public documents', () => {
  it('registers the hub and four works-with pages for sitemap and LLM discovery', () => {
    expect(COMPARE_PUBLIC_DOCUMENTS.documents.map((document) => document.canonicalPath)).toEqual([
      COMPARE_HUB.route,
      ...COMPARE_TOOLS.map((tool) => tool.route),
    ]);
    expect(PUBLIC_DOCUMENT_REGISTRY.get(COMPARE_HUB.route)).toBe(findCompareHubDocument());

    const sitemapUrls = buildPublicSitemap(PUBLIC_DOCUMENT_REGISTRY, SITE_URL).map(
      (entry) => entry.url,
    );
    expect(sitemapUrls).toContain(`${SITE_URL}${COMPARE_HUB.route}`);
    for (const tool of COMPARE_TOOLS) {
      expect(PUBLIC_DOCUMENT_REGISTRY.get(tool.route)).toBe(findComparePublicDocument(tool));
      expect(sitemapUrls).toContain(`${SITE_URL}${tool.route}`);
    }
  });

  it('publishes compare summaries in both LLM documents', () => {
    const compact = buildLlmsTxt({ registry: PUBLIC_DOCUMENT_REGISTRY, siteUrl: SITE_URL });
    const full = buildLlmsFullTxt({ registry: PUBLIC_DOCUMENT_REGISTRY, siteUrl: SITE_URL });

    expect(compact).toContain('## Works with');
    expect(compact).toContain(`[Works with](${SITE_URL}/compare)`);
    expect(compact).toContain(`[Works with Linear](${SITE_URL}/compare/linear)`);
    expect(full).toContain(`URL: ${SITE_URL}/compare/hubspot`);
  });
});
