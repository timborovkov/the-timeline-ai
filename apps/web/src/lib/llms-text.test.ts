import { afterEach, describe, expect, it } from 'vitest';

import type { PublicDocument } from '@/lib/public-site';

import { HELP_PAGES } from '@/lib/help-content';
import { buildLlmsFullTxt, buildLlmsTxt } from '@/lib/llms-text';
import {
  createPublicDocumentRegistry,
  definePublicDocuments,
  PUBLIC_DOCUMENT_REGISTRY,
} from '@/lib/public-site';

const ENV_BACKUP = { ...process.env };

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

describe('llms text files', () => {
  it('builds a root llms.txt index with canonical public URLs', () => {
    process.env.AUTH_URL = 'https://thetimeline.cc';
    delete process.env.VERCEL_URL;
    delete process.env.NEXTAUTH_URL;

    const text = buildLlmsTxt();

    expect(text).toContain('# The Timeline');
    expect(text).toContain('[Landing page](https://thetimeline.cc/)');
    expect(text).toContain('[llms-full.txt](https://thetimeline.cc/llms-full.txt)');
    expect(text).toContain('Signed-in app routes, auth routes, invite routes, and API routes');
    for (const page of HELP_PAGES) {
      expect(text).toContain(`[${page.title}](https://thetimeline.cc/help/${page.slug})`);
    }
  });

  it('builds an expanded llms-full.txt with help page bodies', () => {
    process.env.AUTH_URL = 'https://thetimeline.cc';
    delete process.env.VERCEL_URL;
    delete process.env.NEXTAUTH_URL;

    const text = buildLlmsFullTxt();

    expect(text).toContain('## Product positioning');
    expect(text).toContain('## Search and citation guidance for AI systems');
    for (const page of HELP_PAGES) {
      expect(text).toContain(`### ${page.title}`);
      expect(text).toContain(`URL: https://thetimeline.cc/help/${page.slug}`);
      expect(text).toContain(page.description);
    }
  });

  it('escapes contributed labels and summaries without reading the deployment environment', () => {
    const registry = createPublicDocumentRegistry(
      definePublicDocuments('escaping-test', [
        testDocument({
          canonicalPath: '/safe-guide',
          title: 'Safe guide',
          llms: {
            section: 'primary',
            order: 1,
            label: 'Guide [one] \\ path',
            summary: 'Use <script>globalThis.evil()</script> safely.',
          },
        }),
      ]),
    );

    process.env.AUTH_URL = 'https://wrong.example';
    const text = buildLlmsTxt({ registry, siteUrl: 'https://canonical.example/base' });

    expect(text).toContain(
      '[Guide \\[one\\] \\\\ path](https://canonical.example/safe-guide): Use &lt;script&gt;globalThis.evil()&lt;/script&gt; safely.',
    );
    expect(text).not.toContain('wrong.example');
  });

  it('renders integration and how-it-works contributions in both LLM documents', () => {
    const registry = createPublicDocumentRegistry(
      definePublicDocuments('existing-public-documents', PUBLIC_DOCUMENT_REGISTRY.all()),
      definePublicDocuments('discovery-contributions', [
        testDocument({
          canonicalPath: '/integrations/github',
          kind: 'connector',
          title: 'GitHub integration',
          capability: { kind: 'native-ingestion', provider: 'github' },
          llms: {
            section: 'integrations',
            order: 1,
            summary: 'Capture GitHub activity as cited timeline evidence.',
          },
        }),
        testDocument({
          canonicalPath: '/how-it-works/why-citations-matter',
          kind: 'guide',
          title: 'Why citations matter',
          llms: {
            section: 'how-it-works',
            order: 1,
            summary: 'An editorial note about evidence-backed answers.',
          },
        }),
      ]),
    );

    const compact = buildLlmsTxt({ registry, siteUrl: 'https://thetimeline.cc' });
    const full = buildLlmsFullTxt({ registry, siteUrl: 'https://thetimeline.cc' });

    expect(compact).toContain('## Integrations');
    expect(compact).toContain(
      '[GitHub integration](https://thetimeline.cc/integrations/github): Capture GitHub activity as cited timeline evidence.',
    );
    expect(compact).toContain('## How Timeline works');
    expect(compact).toContain(
      '[Why citations matter](https://thetimeline.cc/how-it-works/why-citations-matter): An editorial note about evidence-backed answers.',
    );
    expect(full).toContain('## Integrations');
    expect(full).toContain('URL: https://thetimeline.cc/integrations/github');
    expect(full).toContain('## How Timeline works');
    expect(full).toContain('URL: https://thetimeline.cc/how-it-works/why-citations-matter');
  });
});

function testDocument(overrides: Partial<PublicDocument>): PublicDocument {
  return {
    canonicalPath: '/test',
    kind: 'guide',
    title: 'Test',
    description: 'Test public document.',
    indexability: 'index',
    dates: { modified: '2026-08-12', reviewed: '2026-08-12' },
    capability: { kind: 'current-product' },
    sitemap: false,
    structuredData: [],
    llms: false,
    ...overrides,
  };
}
