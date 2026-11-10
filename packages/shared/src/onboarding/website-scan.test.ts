import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  FIRECRAWL_API_ORIGIN,
  type FirecrawlFetch,
} from '#src/onboarding/firecrawl-website-scan.js';
import { WEBSITE_SCAN_PAGE_CAP } from '#src/onboarding/first-run.js';
import {
  discoverSameOriginPages,
  htmlToReadableText,
  parseRobotsTxt,
  robotsAllowsPath,
  scanPublicWebsite,
  scanPublicWebsiteInHouse,
  WEBSITE_SCAN_USER_AGENT,
  type WebsiteScanFetch,
} from '#src/onboarding/website-scan.js';

const HOME = `https://studio.example/`;

function html(body: string, title = 'Studio'): string {
  return `<html><head><title>${title}</title></head><body>${body}</body></html>`;
}

function page(text: string): string {
  return html(`<p>${text}</p>`);
}

function readable(label: string): string {
  return `${label} ${'work record context '.repeat(8).trim()}`;
}

function response(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' }, ...init });
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof Request) return input.url;
  return input.href;
}

function fetchMap(pages: Record<string, Response | Error>): WebsiteScanFetch {
  return (input) => {
    const url = String(input);
    const match =
      pages[url] ??
      pages[url.endsWith('/') ? url.slice(0, -1) : `${url}/`] ??
      new Response('missing', { status: 404 });
    if (match instanceof Error) return Promise.reject(match);
    return Promise.resolve(match);
  };
}

describe('website scan crawl', () => {
  it('parses robots groups and honors TimelineBot over star', () => {
    const groups = parseRobotsTxt(`
User-agent: *
Disallow: /

User-agent: TimelineBot
Allow: /
Disallow: /secret
`);
    expect(robotsAllowsPath(groups, WEBSITE_SCAN_USER_AGENT, '/')).toBe(true);
    expect(robotsAllowsPath(groups, WEBSITE_SCAN_USER_AGENT, '/secret')).toBe(false);
    expect(robotsAllowsPath(groups, 'OtherBot/1.0', '/')).toBe(false);
  });

  it('extracts readable text without scripts', () => {
    const { title, text } = htmlToReadableText(
      html('<script>ignore()</script><p>Design sprints for B2B teams.</p>', 'Acme Studio'),
    );
    expect(title).toBe('Acme Studio');
    expect(text).toContain('Design sprints for B2B teams.');
    expect(text).not.toContain('ignore()');
  });

  it('keeps same-origin public pages and drops off-origin links', () => {
    const urls = discoverSameOriginPages(
      html(`
        <a href="/about">About</a>
        <a href="https://studio.example/pricing">Pricing</a>
        <a href="https://other.example/team">Other</a>
        <a href="mailto:hi@studio.example">Mail</a>
      `),
      new URL(HOME),
    );
    expect(urls).toEqual(['https://studio.example/about', 'https://studio.example/pricing']);
  });

  it('reads home plus preferred same-origin pages and stops at the cap', async () => {
    const extra = ['about', 'pricing', 'product', 'team', 'secret', 'blog'];
    const pages: Record<string, Response> = {
      'https://studio.example/robots.txt': response('User-agent: *\nAllow: /\n', {
        headers: { 'content-type': 'text/plain' },
      }),
      [HOME]: response(
        html(
          extra.map((slug) => `<a href="/${slug}">${slug}</a>`).join('') +
            `<p>${readable('Home')}</p>`,
        ),
      ),
    };
    for (const slug of extra) {
      pages[`https://studio.example/${slug}`] = response(page(readable(slug)));
    }
    const result = await scanPublicWebsiteInHouse(HOME, { fetchPage: fetchMap(pages) });
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

  it('matches RFC 9309 wildcard and end-anchored robots patterns', () => {
    const groups = parseRobotsTxt(`
User-agent: *
Disallow: /private/*
Disallow: /index.html$
Allow: /private/public
`);
    expect(robotsAllowsPath(groups, WEBSITE_SCAN_USER_AGENT, '/private/secret')).toBe(false);
    expect(robotsAllowsPath(groups, WEBSITE_SCAN_USER_AGENT, '/private/public')).toBe(true);
    expect(robotsAllowsPath(groups, WEBSITE_SCAN_USER_AGENT, '/about')).toBe(true);
    expect(robotsAllowsPath(groups, WEBSITE_SCAN_USER_AGENT, '/index.html')).toBe(false);
    expect(robotsAllowsPath(groups, WEBSITE_SCAN_USER_AGENT, '/index.html?x=1')).toBe(true);
    expect(robotsAllowsPath(groups, WEBSITE_SCAN_USER_AGENT, '/index.html/extra')).toBe(true);
  });

  it('does not fetch a path blocked by a wildcard Disallow', async () => {
    const result = await scanPublicWebsiteInHouse(HOME, {
      fetchPage: fetchMap({
        'https://studio.example/robots.txt': response('User-agent: *\nDisallow: /private/*\n', {
          headers: { 'content-type': 'text/plain' },
        }),
        [HOME]: response(
          html(
            `<a href="/private/secret">Secret</a><a href="/about">About</a><p>${readable('Home')}</p>`,
          ),
        ),
        'https://studio.example/private/secret': response(page(readable('Secret'))),
        'https://studio.example/about': response(page(readable('About'))),
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((item) => item.url)).toEqual([HOME, 'https://studio.example/about']);
  });

  it('resolves relative links against the final redirected home URL', async () => {
    const result = await scanPublicWebsiteInHouse(HOME, {
      fetchPage: fetchMap({
        'https://studio.example/robots.txt': new Response('missing', { status: 404 }),
        [HOME]: new Response(null, {
          status: 302,
          headers: { location: 'https://studio.example/en/' },
        }),
        'https://studio.example/en/': response(
          html(`<a href="about">About</a><p>${readable('Home')}</p>`),
        ),
        'https://studio.example/en/about': response(page(readable('About'))),
        'https://studio.example/about': response(page(readable('Wrong about'))),
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((item) => item.url)).toEqual([
      'https://studio.example/en',
      'https://studio.example/en/about',
    ]);
  });

  it('treats an empty Disallow as allowing the site', async () => {
    const result = await scanPublicWebsiteInHouse(HOME, {
      fetchPage: fetchMap({
        'https://studio.example/robots.txt': response('User-agent: *\nDisallow:\n', {
          headers: { 'content-type': 'text/plain' },
        }),
        [HOME]: response(page(readable('Home'))),
      }),
    });
    expect(result.ok).toBe(true);
  });

  it('does not follow a same-origin redirect into a robots-disallowed path', async () => {
    const result = await scanPublicWebsiteInHouse(HOME, {
      fetchPage: fetchMap({
        'https://studio.example/robots.txt': response('User-agent: *\nDisallow: /private\n', {
          headers: { 'content-type': 'text/plain' },
        }),
        [HOME]: new Response(null, {
          status: 302,
          headers: { location: 'https://studio.example/private' },
        }),
        'https://studio.example/private': response(page(readable('Secret'))),
      }),
    });
    expect(result).toEqual({ ok: false, reason: 'robots' });
  });

  it('fails closed when robots disallow the site', async () => {
    const result = await scanPublicWebsiteInHouse(HOME, {
      fetchPage: fetchMap({
        'https://studio.example/robots.txt': response('User-agent: *\nDisallow: /\n', {
          headers: { 'content-type': 'text/plain' },
        }),
        [HOME]: response(page(readable('Home'))),
      }),
    });
    expect(result).toEqual({ ok: false, reason: 'robots' });
  });

  it('fails when the home page has no readable text', async () => {
    const result = await scanPublicWebsiteInHouse(HOME, {
      fetchPage: fetchMap({
        'https://studio.example/robots.txt': new Response('missing', { status: 404 }),
        [HOME]: response(html('<div id="app"></div>')),
      }),
    });
    expect(result).toEqual({ ok: false, reason: 'no_readable_text' });
  });

  it('does not follow a cross-origin redirect from home', async () => {
    const result = await scanPublicWebsiteInHouse(HOME, {
      fetchPage: fetchMap({
        'https://studio.example/robots.txt': new Response('missing', { status: 404 }),
        [HOME]: new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example/phish' },
        }),
        'https://evil.example/phish': response(page(readable('Phish'))),
      }),
    });
    expect(result).toEqual({ ok: false, reason: 'no_readable_text' });
  });

  it('rejects local addresses before fetching', async () => {
    const fetchPage = fetchMap({});
    const result = await scanPublicWebsiteInHouse('http://127.0.0.1/', { fetchPage });
    expect(result).toEqual({ ok: false, reason: 'unreachable' });
  });
});

const FIRECRAWL_KEY = 'fc-test';

function firecrawlFetch(options: {
  pages?: { url: string; title: string; markdown: string; statusCode?: number }[];
  robotsBlocked?: string[];
  startStatus?: number;
  crawlStatus?: string;
  errorBody?: string;
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
  it('refuses a scan when the Firecrawl key is missing', async () => {
    const result = await scanPublicWebsite(HOME, { firecrawlApiKey: '' });
    expect(result).toEqual({ ok: false, reason: 'not_enabled' });
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

  it('falls back to the in-house fetcher on Firecrawl 5xx', async () => {
    const result = await scanPublicWebsite(HOME, {
      firecrawlApiKey: FIRECRAWL_KEY,
      firecrawlFetch: firecrawlFetch({ startStatus: 503 }),
      fetchPage: fetchMap({
        'https://studio.example/robots.txt': new Response('missing', { status: 404 }),
        [HOME]: response(page(readable('Home'))),
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((item) => item.url)).toEqual([HOME]);
  });

  it('does not fall back when Firecrawl reports robots', async () => {
    const result = await scanPublicWebsite(HOME, {
      firecrawlApiKey: FIRECRAWL_KEY,
      firecrawlFetch: firecrawlFetch({ pages: [], robotsBlocked: [HOME] }),
      fetchPage: fetchMap({
        'https://studio.example/robots.txt': new Response('missing', { status: 404 }),
        [HOME]: response(page(readable('Home'))),
      }),
    });
    expect(result).toEqual({ ok: false, reason: 'robots' });
  });

  it('maps Firecrawl 429 to rate_limited without falling back', async () => {
    const result = await scanPublicWebsite(HOME, {
      firecrawlApiKey: FIRECRAWL_KEY,
      firecrawlFetch: firecrawlFetch({ startStatus: 429, errorBody: 'Rate limit exceeded' }),
      fetchPage: fetchMap({
        [HOME]: response(page(readable('Home'))),
      }),
    });
    expect(result).toEqual({ ok: false, reason: 'rate_limited' });
  });
});
