import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { AGENTS_HUB } from '@/components/marketing/agents/content';
import {
  AGENTS_HUB_DOCUMENT,
  AGENTS_PUBLIC_DOCUMENTS,
} from '@/components/marketing/agents/public-documents';
import { AGENT_SETUP_CARD, TIMELINE_AGENT_SETUP_COMMAND } from '@/components/marketing/copy';
import { buildLlmsFullTxt, buildLlmsTxt } from '@/lib/llms-text';
import { PUBLIC_DOCUMENT_REGISTRY } from '@/lib/public-site';
import { buildPublicSitemap } from '@/lib/public-site/sitemap';

const SITE_URL = 'https://thetimeline.cc';

describe('agents public documents', () => {
  it('registers the hub for sitemap and LLM discovery with the teammates framing', () => {
    expect(AGENTS_PUBLIC_DOCUMENTS.documents).toEqual([AGENTS_HUB_DOCUMENT]);
    expect(PUBLIC_DOCUMENT_REGISTRY.get(AGENTS_HUB.route)).toBe(AGENTS_HUB_DOCUMENT);
    expect(AGENTS_HUB_DOCUMENT).toMatchObject({
      title: AGENTS_HUB.seoTitle,
      description: AGENTS_HUB.seoDescription,
      dates: { modified: '2026-11-07', reviewed: '2026-11-07' },
      capability: { kind: 'current-product' },
    });
    expect(AGENTS_HUB_DOCUMENT.llms).toMatchObject({
      summary: AGENTS_HUB.llmsSummary,
    });
    expect(AGENTS_HUB_DOCUMENT.llms.sections[0]).toMatchObject({
      title: AGENT_SETUP_CARD.title,
      body: AGENT_SETUP_CARD.body,
      codeBlock: { content: TIMELINE_AGENT_SETUP_COMMAND, language: 'text' },
    });

    const sitemapUrls = buildPublicSitemap(PUBLIC_DOCUMENT_REGISTRY, SITE_URL).map(
      (entry) => entry.url,
    );
    expect(sitemapUrls).toContain(`${SITE_URL}${AGENTS_HUB.route}`);
  });

  it('publishes the dual-direction agents summary in compact llms.txt', () => {
    const compact = buildLlmsTxt({ registry: PUBLIC_DOCUMENT_REGISTRY, siteUrl: SITE_URL });
    const full = buildLlmsFullTxt({ registry: PUBLIC_DOCUMENT_REGISTRY, siteUrl: SITE_URL });

    expect(compact).toContain(`[Agents](${SITE_URL}/agents): ${AGENTS_HUB.llmsSummary}`);
    expect(compact).toContain('Agents can contribute progress notes as cited evidence');
    expect(full).toContain(AGENT_SETUP_CARD.title);
    expect(full).toContain('not a dedicated Grok Bot product');
  });
});
