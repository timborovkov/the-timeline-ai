import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { WEBSITE_SCAN_PAGE_CAP } from '#src/onboarding/first-run.js';
import {
  discoverSameOriginPages,
  htmlToReadableText,
  parseRobotsTxt,
  robotsAllowsPath,
  scanPublicWebsite,
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
    const result = await scanPublicWebsite(HOME, { fetchPage: fetchMap(pages) });
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

  it('treats an empty Disallow as allowing the site', async () => {
    const result = await scanPublicWebsite(HOME, {
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
    const result = await scanPublicWebsite(HOME, {
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
    const result = await scanPublicWebsite(HOME, {
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
    const result = await scanPublicWebsite(HOME, {
      fetchPage: fetchMap({
        'https://studio.example/robots.txt': new Response('missing', { status: 404 }),
        [HOME]: response(html('<div id="app"></div>')),
      }),
    });
    expect(result).toEqual({ ok: false, reason: 'no_readable_text' });
  });

  it('does not follow a cross-origin redirect from home', async () => {
    const result = await scanPublicWebsite(HOME, {
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
    const result = await scanPublicWebsite('http://127.0.0.1/', { fetchPage });
    expect(result).toEqual({ ok: false, reason: 'unreachable' });
  });
});
