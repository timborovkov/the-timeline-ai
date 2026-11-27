import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { checkPublicOrigin } from './check-public-origin';

import { buildLlmsFullTxt, buildLlmsTxt } from '@/lib/llms-text';
import { buildPublicSitemap, PUBLIC_DOCUMENT_REGISTRY } from '@/lib/public-site';

const origin = 'https://preview.example.test';
const alias = 'https://alias.example.test';
const sitemap = buildPublicSitemap(PUBLIC_DOCUMENT_REGISTRY, origin);
const sitemapXml = `<urlset>${sitemap.map(({ url }) => `<url><loc>${url}</loc></url>`).join('')}</urlset>`;

function fixture(responses: Record<string, Response> = {}) {
  return (href: string, options: RequestInit) => {
    expect(options.redirect).toBe('manual');
    const url = new URL(href);
    const override = responses[url.pathname];
    if (override) return override;
    if (url.origin === alias) return Response.redirect(origin + url.pathname + url.search, 308);
    if (url.origin !== origin) throw new Error(`Unexpected fetch to ${url.origin}`);
    switch (url.pathname) {
      case '/robots.txt':
        return new Response(`Sitemap: ${origin}/sitemap.xml\n`);
      case '/sitemap.xml':
        return new Response(sitemapXml);
      case '/llms.txt':
        return new Response(buildLlmsTxt({ siteUrl: origin }));
      case '/llms-full.txt':
        return new Response(buildLlmsFullTxt({ siteUrl: origin }));
      case '/docs':
        return redirect('/help');
      case '/security':
        return redirect('/trust');
      case '/record':
        return redirect('/how-it-works');
      case '/solutions/weekly-project-updates':
        return redirect('/use-cases/team-daily-log');
      case '/use-cases/work-record':
        return redirect('/how-it-works');
      case '/use-cases/crm':
      case '/solutions/crm-context-from-team-activity':
        return redirect('/use-cases/customer-context');
      default:
        if (/^\/compare\/(?:hubspot|jira|linear|notion)$/u.test(url.pathname)) {
          return redirect(url.pathname.replace('/compare/', '/integrations/'));
        }
        return new Response(`<link rel="canonical" href="${href}">`, {
          headers: { 'Content-Type': 'text/html' },
        });
    }
  };
}

function redirect(location: string) {
  return new Response(null, { status: 308, headers: { location } });
}

describe('post-deployment public origin check', () => {
  it('checks all sitemap pages without following redirects or fetching citations', async () => {
    expect(await checkPublicOrigin(origin, [alias], fixture())).toEqual({
      checkedPages: sitemap.length,
      failures: [],
    });
  });

  it('reports runtime origin, canonical, redirect, and LLM link drift', async () => {
    const { failures } = await checkPublicOrigin(
      origin,
      [alias],
      fixture({
        '/robots.txt': new Response('Sitemap: https://wrong.example/sitemap.xml\n'),
        '/trust': new Response('<link rel="canonical" href="https://wrong.example/trust">'),
        '/docs': redirect('https://wrong.example/help'),
        '/solutions/crm-context-from-team-activity': redirect('/use-cases/crm'),
        '/llms.txt': new Response(
          buildLlmsTxt({ siteUrl: origin }).replace(
            `${origin}/pricing`,
            'https://wrong.example/pricing',
          ),
        ),
      }),
    );

    expect(failures).toEqual([
      expect.stringContaining('/docs — Expected 308'),
      expect.stringContaining('/llms.txt — LLM link mismatch'),
      expect.stringContaining('/robots.txt — robots Sitemap mismatch'),
      expect.stringContaining('/solutions/crm-context-from-team-activity — Expected 308'),
      expect.stringContaining('/trust — Expected one canonical'),
    ]);
  });

  it('rejects a sitemap built for a different origin before crawling its pages', async () => {
    const result = await checkPublicOrigin(
      origin,
      [],
      fixture({
        '/sitemap.xml': new Response(sitemapXml.replaceAll(origin, 'https://wrong.example')),
      }),
    );

    expect(result.checkedPages).toBe(0);
    expect(result.failures).toEqual([
      expect.stringContaining('/sitemap.xml — sitemap URL mismatch'),
    ]);
  });
});
