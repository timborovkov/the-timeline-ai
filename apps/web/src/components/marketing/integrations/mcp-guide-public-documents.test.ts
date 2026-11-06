import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { MCP_GUIDE_PAGE } from '@/components/marketing/integrations/mcp-guide-content';
import {
  MCP_GUIDE_DOCUMENT,
  MCP_GUIDE_PUBLIC_DOCUMENTS,
} from '@/components/marketing/integrations/mcp-guide-public-documents';
import { buildLlmsTxt } from '@/lib/llms-text';
import { PUBLIC_DOCUMENT_REGISTRY } from '@/lib/public-site';
import { buildPublicSitemap } from '@/lib/public-site/sitemap';

const SITE_URL = 'https://thetimeline.cc';

describe('MCP guide public document', () => {
  it('registers /integrations/mcp for sitemap and LLM discovery', () => {
    expect(MCP_GUIDE_PUBLIC_DOCUMENTS.documents.map((document) => document.canonicalPath)).toEqual([
      MCP_GUIDE_PAGE.route,
    ]);
    expect(PUBLIC_DOCUMENT_REGISTRY.get(MCP_GUIDE_PAGE.route)).toBe(MCP_GUIDE_DOCUMENT);

    const sitemapUrls = buildPublicSitemap(PUBLIC_DOCUMENT_REGISTRY, SITE_URL).map(
      (entry) => entry.url,
    );
    expect(sitemapUrls).toContain(`${SITE_URL}${MCP_GUIDE_PAGE.route}`);

    const compact = buildLlmsTxt({ registry: PUBLIC_DOCUMENT_REGISTRY, siteUrl: SITE_URL });
    expect(compact).toContain(`[Connect MCP tools](${SITE_URL}/integrations/mcp)`);
    expect(JSON.stringify(MCP_GUIDE_DOCUMENT.llms)).toContain(
      'Hosted catalog tools: Notion, Jira, Confluence, and Stripe',
    );
    expect(JSON.stringify(MCP_GUIDE_DOCUMENT.llms)).toContain('Local desktop: Figma');
  });
});
