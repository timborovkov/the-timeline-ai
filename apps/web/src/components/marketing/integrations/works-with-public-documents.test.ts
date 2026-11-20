import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { WORKS_WITH_PAGE_TOOLS } from '@/components/marketing/integrations/works-with-content';
import {
  WORKS_WITH_PUBLIC_DOCUMENTS,
  findWorksWithPublicDocument,
} from '@/components/marketing/integrations/works-with-public-documents';
import { buildLlmsFullTxt, buildLlmsTxt } from '@/lib/llms-text';
import { metadataForPublicDocument, PUBLIC_DOCUMENT_REGISTRY } from '@/lib/public-site';
import { buildPublicSitemap } from '@/lib/public-site/sitemap';

const SITE_URL = 'https://thetimeline.cc';

describe('works-with public documents', () => {
  it('discovers live lookup pages and keeps Coming soon pages out of discovery', () => {
    expect(WORKS_WITH_PUBLIC_DOCUMENTS.documents.map((document) => document.canonicalPath)).toEqual(
      WORKS_WITH_PAGE_TOOLS.map((tool) => tool.route),
    );

    const sitemapUrls = buildPublicSitemap(PUBLIC_DOCUMENT_REGISTRY, SITE_URL).map(
      (entry) => entry.url,
    );
    const options = { registry: PUBLIC_DOCUMENT_REGISTRY, siteUrl: SITE_URL };
    const compact = buildLlmsTxt(options);
    const full = buildLlmsFullTxt(options);
    for (const tool of WORKS_WITH_PAGE_TOOLS) {
      const document = findWorksWithPublicDocument(tool);
      const url = `${SITE_URL}${tool.route}`;
      expect(PUBLIC_DOCUMENT_REGISTRY.get(tool.route)).toBe(document);
      if (tool.status === 'coming-soon') {
        expect(document.capability).toEqual({ kind: 'planned', provider: tool.slug });
        expect(metadataForPublicDocument(document).robots).toEqual({ index: false, follow: false });
        expect(sitemapUrls).not.toContain(url);
        expect(compact).not.toContain(url);
        expect(full).not.toContain(url);
      } else {
        expect(document.capability).toEqual({ kind: 'mcp-access', provider: tool.slug });
        expect(sitemapUrls).toContain(url);
        expect(compact).toContain(url);
        expect(full).toContain(url);
      }
    }
  });
});
