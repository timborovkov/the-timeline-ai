// Public website scans use only Firecrawl and fail closed on provider errors.
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  FIRECRAWL_API_ORIGIN,
  type FirecrawlFetch,
} from '#src/onboarding/firecrawl-website-scan.js';
import { WEBSITE_SCAN_PAGE_CAP } from '#src/onboarding/first-run.js';
import { scanPublicWebsite } from '#src/onboarding/website-scan.js';
const HOME = 'https://studio.example/';
function readable(label: string): string {
  return `${label} ${'work record context '.repeat(8)}`;
}
function requestUrl(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof Request ? input.url : input.href;
}
const FIRECRAWL_KEY = 'fc-test';

function firecrawlFetch(options: {
  pages?: { url: string; title: string; markdown: string; statusCode?: number }[];
  robotsBlocked?: string[];
  startStatus?: number;
  crawlStatus?: string;
  errorBody?: string;
  creditsUsed?: number;
}): FirecrawlFetch {
  return (input, init) => {
    const url = requestUrl(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url === `${FIRECRAWL_API_ORIGIN}/v2/crawl` && method === 'POST') {
      if (options.startStatus && options.startStatus !== 200) {
        return Promise.resolve(
          new Response(options.errorBody ?? 'fail', { status: options.startStatus }),
        );
      }
      return Promise.resolve(Response.json({ id: 'crawl-1' }));
    }
    if (url.includes('/v2/crawl/crawl-1/errors')) {
      return Promise.resolve(
        Response.json({
          errors: options.errorBody ? [{ url: HOME, error: options.errorBody }] : [],
          robotsBlocked: options.robotsBlocked ?? [],
        }),
      );
    }
    if (url.includes('/v2/crawl/crawl-1')) {
      return Promise.resolve(
        Response.json({
          status: options.crawlStatus ?? 'completed',
          creditsUsed: options.creditsUsed,
          data: (options.pages ?? []).map((page) => ({
            markdown: page.markdown,
            metadata: {
              title: page.title,
              sourceURL: page.url,
              statusCode: page.statusCode ?? 200,
            },
          })),
        }),
      );
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  };
}

describe('website scan Firecrawl crawl', () => {
  it.each([0, 7])(
    'retains %i provider credits independently of captured page count',
    async (creditsUsed) => {
      const result = await scanPublicWebsite(HOME, {
        firecrawlApiKey: FIRECRAWL_KEY,
        firecrawlFetch: firecrawlFetch({
          creditsUsed,
          pages: [{ url: HOME, title: 'Studio', markdown: readable('Home') }],
        }),
      });
      expect(result.ok).toBe(true);
      expect(result.providerCredits).toBe(creditsUsed);
      if (result.ok) expect(result.pages).toHaveLength(1);
    },
  );

  it('retains provider credits for an unusable failed crawl', async () => {
    const result = await scanPublicWebsite(HOME, {
      firecrawlApiKey: FIRECRAWL_KEY,
      firecrawlFetch: firecrawlFetch({ crawlStatus: 'failed', creditsUsed: 3 }),
    });
    expect(result).toEqual({ ok: false, reason: 'unreachable', providerCredits: 3 });
  });

  it.each([
    ['failed', 'provider_failed'],
    ['cancelled', 'provider_cancelled'],
    ['completed', 'provider_page_errors'],
  ] as const)(
    'preserves usable pages and partial failure for provider status %s',
    async (crawlStatus, reason) => {
      const result = await scanPublicWebsite(HOME, {
        firecrawlApiKey: FIRECRAWL_KEY,
        firecrawlFetch: firecrawlFetch({
          crawlStatus,
          creditsUsed: 3,
          errorBody: 'Some pages could not be fetched',
          pages: [{ url: HOME, title: 'Studio', markdown: readable('Home') }],
        }),
      });
      expect(result.ok).toBe(true);
      expect(result.providerCredits).toBe(3);
      if (result.ok) {
        expect(result.pages).toHaveLength(1);
        expect(result.partialFailureReason).toBe(reason);
      }
    },
  );

  it('refuses a scan when the Firecrawl key is missing', async () => {
    await expect(scanPublicWebsite(HOME, { firecrawlApiKey: '' })).rejects.toThrow(
      'FIRECRAWL_API_KEY is required',
    );
  });

  it('rejects local addresses before calling Firecrawl', async () => {
    let called = false;
    const result = await scanPublicWebsite('http://127.0.0.1/', {
      firecrawlApiKey: FIRECRAWL_KEY,
      firecrawlFetch: () => {
        called = true;
        return Promise.resolve(new Response('nope', { status: 500 }));
      },
    });
    expect(result).toEqual({ ok: false, reason: 'unreachable' });
    expect(called).toBe(false);
  });

  it('maps Firecrawl markdown pages and caps at five', async () => {
    const extra = ['about', 'pricing', 'product', 'team', 'blog'];
    const result = await scanPublicWebsite(HOME, {
      firecrawlApiKey: FIRECRAWL_KEY,
      firecrawlFetch: firecrawlFetch({
        pages: [
          { url: HOME, title: 'Studio', markdown: readable('Home') },
          ...extra.map((slug) => ({
            url: `https://studio.example/${slug}`,
            title: slug,
            markdown: readable(slug),
          })),
        ],
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toHaveLength(WEBSITE_SCAN_PAGE_CAP);
    expect(result.pages[0]?.url).toBe(HOME);
    expect(result.pages.map((item) => item.url)).toEqual([
      HOME,
      'https://studio.example/about',
      'https://studio.example/pricing',
      'https://studio.example/product',
      'https://studio.example/team',
    ]);
  });

  it('preserves distinct trailing-slash source URLs in citations', async () => {
    const urls = ['https://studio.example/about', 'https://studio.example/about/'];
    const result = await scanPublicWebsite(HOME, {
      firecrawlApiKey: FIRECRAWL_KEY,
      firecrawlFetch: firecrawlFetch({
        pages: urls.map((url) => ({ url, title: 'About', markdown: readable(url) })),
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected readable pages');
    expect(result.pages.map((page) => page.url)).toEqual(urls);
  });

  it('maps robots-blocked home pages to robots', async () => {
    const result = await scanPublicWebsite(HOME, {
      firecrawlApiKey: FIRECRAWL_KEY,
      firecrawlFetch: firecrawlFetch({
        pages: [],
        robotsBlocked: [HOME],
      }),
    });
    expect(result).toEqual({ ok: false, reason: 'robots' });
  });

  it('maps empty markdown to no_readable_text', async () => {
    const result = await scanPublicWebsite(HOME, {
      firecrawlApiKey: FIRECRAWL_KEY,
      firecrawlFetch: firecrawlFetch({
        pages: [{ url: HOME, title: 'Studio', markdown: 'short' }],
      }),
    });
    expect(result).toEqual({ ok: false, reason: 'no_readable_text' });
  });

  it('retries provider outages without fetching the website directly', async () => {
    await expect(
      scanPublicWebsite(HOME, {
        firecrawlApiKey: FIRECRAWL_KEY,
        firecrawlFetch: firecrawlFetch({ startStatus: 503 }),
      }),
    ).rejects.toThrow('Firecrawl is temporarily unavailable');
  });

  it('does not fall back when Firecrawl reports robots', async () => {
    const result = await scanPublicWebsite(HOME, {
      firecrawlApiKey: FIRECRAWL_KEY,
      firecrawlFetch: firecrawlFetch({ pages: [], robotsBlocked: [HOME] }),
    });
    expect(result).toEqual({ ok: false, reason: 'robots' });
  });

  it('preserves a known provider rejection so a retry cannot duplicate an accepted crawl', async () => {
    await expect(
      scanPublicWebsite(HOME, {
        firecrawlApiKey: FIRECRAWL_KEY,
        firecrawlFetch: firecrawlFetch({ startStatus: 429, errorBody: 'Rate limit exceeded' }),
      }),
    ).rejects.toMatchObject({ providerRejected: true });
  });
  it('rejects embedded URL credentials before contacting Firecrawl', async () => {
    let called = false;
    const result = await scanPublicWebsite('https://user:password@example.com/', {
      firecrawlApiKey: FIRECRAWL_KEY,
      firecrawlFetch: () => {
        called = true;
        return Promise.resolve(new Response());
      },
    });
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
  it('resumes a checkpointed crawl without starting another provider job', async () => {
    const methods: string[] = [];
    const result = await scanPublicWebsite(HOME, {
      firecrawlApiKey: FIRECRAWL_KEY,
      crawlId: 'crawl-1',
      firecrawlFetch: async (input, init) => {
        methods.push(init?.method ?? 'GET');
        return firecrawlFetch({
          pages: [{ url: HOME, title: 'Studio', markdown: readable('Home') }],
        })(input, init);
      },
    });
    expect(result.ok).toBe(true);
    expect(methods).not.toContain('POST');
  });
});
