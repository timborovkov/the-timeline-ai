import { afterEach, describe, expect, it } from 'vitest';

import { HELP_PAGES } from '@/lib/help-content';
import { buildLlmsFullTxt, buildLlmsTxt } from '@/lib/llms-text';

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
});
