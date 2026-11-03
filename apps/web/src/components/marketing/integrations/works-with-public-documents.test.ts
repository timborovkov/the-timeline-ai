import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { WORKS_WITH_PAGE_TOOLS } from '@/components/marketing/integrations/works-with-content';
import {
  WORKS_WITH_PUBLIC_DOCUMENTS,
  findWorksWithPublicDocument,
} from '@/components/marketing/integrations/works-with-public-documents';
import { buildLlmsTxt } from '@/lib/llms-text';
import { PUBLIC_DOCUMENT_REGISTRY } from '@/lib/public-site';
import { buildPublicSitemap } from '@/lib/public-site/sitemap';

const SITE_URL = 'https://thetimeline.cc';

describe('works-with public documents', () => {
  it('registers the five non-native works-with pages for sitemap and LLM discovery', () => {
    expect(WORKS_WITH_PUBLIC_DOCUMENTS.documents.map((document) => document.canonicalPath)).toEqual(
      WORKS_WITH_PAGE_TOOLS.map((tool) => tool.route),
    );

    const sitemapUrls = buildPublicSitemap(PUBLIC_DOCUMENT_REGISTRY, SITE_URL).map(
      (entry) => entry.url,
    );
    for (const tool of WORKS_WITH_PAGE_TOOLS) {
      expect(PUBLIC_DOCUMENT_REGISTRY.get(tool.route)).toBe(findWorksWithPublicDocument(tool));
      expect(sitemapUrls).toContain(`${SITE_URL}${tool.route}`);
      expect(findWorksWithPublicDocument(tool).capability.kind).not.toBe('planned');
    }

    const compact = buildLlmsTxt({ registry: PUBLIC_DOCUMENT_REGISTRY, siteUrl: SITE_URL });
    expect(compact).toContain(`[Works with HubSpot](${SITE_URL}/integrations/hubspot)`);
    expect(compact).toContain(`[Works with Jira](${SITE_URL}/integrations/jira)`);
  });
});
