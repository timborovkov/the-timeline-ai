import { LEGACY_COMPARE_REDIRECTS } from '@/components/marketing/compare/content';
import { HOW_IT_WORKS_ROUTE } from '@/components/marketing/editorial/content';
import { USE_CASE_ROUTES } from '@/components/marketing/use-cases/content';
import { buildLlmsFullTxt, buildLlmsTxt } from '@/lib/llms-text';
import { llmsUrlReferences } from '@/lib/llms-url-references';
import { buildPublicSitemap, PUBLIC_DOCUMENT_REGISTRY } from '@/lib/public-site';

const LEGACY_REDIRECTS = {
  '/docs': '/help',
  '/security': '/trust',
  '/record': HOW_IT_WORKS_ROUTE,
  '/solutions/weekly-project-updates': USE_CASE_ROUTES.teamDailyLog,
  '/solutions/crm-context-from-team-activity': USE_CASE_ROUTES.crm,
  ...Object.fromEntries(
    Object.entries(LEGACY_COMPARE_REDIRECTS).map(([slug, target]) => [`/compare/${slug}`, target]),
  ),
};

export async function checkPublicOrigin(
  siteUrl: string,
  aliasUrls: readonly string[] = [],
  fetchPage: (url: string, options: RequestInit) => Response | Promise<Response> = fetch,
) {
  const origin = httpsOrigin(siteUrl);
  const aliases = aliasUrls.map(httpsOrigin);
  if (aliases.includes(origin))
    throw new Error('A host alias must differ from the intended origin.');

  const failures: string[] = [];
  let checkedPages = 0;

  async function verify(url: string, check: (response: Response) => Promise<void>) {
    try {
      const response = await fetchPage(url, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Timeline public site check)' },
        signal: AbortSignal.timeout(12_000),
      });
      try {
        await check(response);
      } finally {
        if (!response.bodyUsed) await response.body?.cancel();
      }
    } catch (error) {
      failures.push(`${url} — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function verifyRedirect(url: string, target: string) {
    return verify(url, (response) => {
      const location = response.headers.get('location');
      if (response.status !== 308 || !location || new URL(location, url).href !== target) {
        throw new Error(
          `Expected 308 to ${target}, received ${response.status} to ${location ?? '(no Location)'}.`,
        );
      }
      return Promise.resolve();
    });
  }

  await Promise.all([
    verify(`${origin}/robots.txt`, async (response) => {
      requireOk(response);
      const robots = await response.text();
      const sitemapUrls = Array.from(
        robots.matchAll(/^sitemap:[ \t]*(\S+)\s*$/gimu),
        ([, url]) => url,
      ).filter((url) => url !== undefined);
      requireSameUrls(sitemapUrls, [`${origin}/sitemap.xml`], 'robots Sitemap');
    }),
    verify(`${origin}/sitemap.xml`, async (response) => {
      requireOk(response);
      const sitemap = await response.text();
      if (!/<urlset\b/u.test(sitemap)) throw new Error('Expected a sitemap URL set.');
      const deployedUrls = Array.from(
        sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu),
        ([, url]) => url,
      ).filter((url) => url !== undefined);
      const expectedUrls = buildPublicSitemap(PUBLIC_DOCUMENT_REGISTRY, origin).map(
        ({ url }) => url,
      );
      requireSameUrls(deployedUrls, expectedUrls, 'sitemap URL');

      for (let index = 0; index < deployedUrls.length; index += 6) {
        await Promise.all(
          deployedUrls.slice(index, index + 6).map((url) =>
            verify(url, async (page) => {
              requireOk(page);
              await requireCanonical(page, url);
              checkedPages += 1;
            }),
          ),
        );
      }
    }),
    ...[
      { path: '/llms.txt', markdown: buildLlmsTxt({ siteUrl: origin }) },
      { path: '/llms-full.txt', markdown: buildLlmsFullTxt({ siteUrl: origin }) },
    ].map(({ path, markdown }) =>
      verify(`${origin}${path}`, async (response) => {
        requireOk(response);
        requireSameUrls(
          llmsUrlReferences(await response.text()),
          llmsUrlReferences(markdown),
          'LLM link',
        );
      }),
    ),
    ...Object.entries(LEGACY_REDIRECTS).map(([path, target]) =>
      verifyRedirect(origin + path, origin + target),
    ),
    ...aliases.map((alias) =>
      verifyRedirect(`${alias}/pricing?origin_check=1`, `${origin}/pricing?origin_check=1`),
    ),
  ]);

  return { checkedPages, failures: failures.sort() };
}

function httpsOrigin(input: string): string {
  const url = URL.parse(input);
  if (url?.protocol !== 'https:' || url.origin + '/' !== url.href) {
    throw new Error(`Expected an HTTPS origin, received ${input}.`);
  }
  return url.origin;
}

function requireOk(response: Response) {
  if (response.status !== 200) {
    const location = response.headers.get('location');
    throw new Error(
      `Expected 200, received ${response.status}${location ? ` to ${location}` : ''}.`,
    );
  }
}

function requireSameUrls(actual: Iterable<string>, expected: Iterable<string>, label: string) {
  const deployed = new Set(actual);
  const intended = new Set(expected);
  const missing = [...intended].filter((url) => !deployed.has(url));
  const unexpected = [...deployed].filter((url) => !intended.has(url));
  if (missing.length || unexpected.length) {
    throw new Error(
      `${label} mismatch. Missing ${missing.length} (${missing.slice(0, 3).join(', ')}). Unexpected ${unexpected.length} (${unexpected.slice(0, 3).join(', ')}).`,
    );
  }
}

async function requireCanonical(response: Response, url: string) {
  const canonicals: (string | null)[] = [];
  await new HTMLRewriter()
    .on('link[rel="canonical"]', {
      element(element) {
        canonicals.push(element.getAttribute('href'));
      },
    })
    .transform(response)
    .arrayBuffer();
  if (canonicals.length !== 1 || URL.parse(canonicals[0] ?? '')?.href !== url) {
    throw new Error(`Expected one canonical matching ${url}, received ${canonicals.join(', ')}.`);
  }
}

if (import.meta.main) {
  const [siteUrl, ...aliases] = Bun.argv.slice(2);
  try {
    if (!siteUrl)
      throw new Error('Usage: bun run check:public-origin <https-origin> [https-alias …]');
    const { checkedPages, failures } = await checkPublicOrigin(siteUrl, aliases);
    if (failures.length) throw new Error(failures.join('\n'));
    console.log(
      `Verified origins across ${checkedPages} sitemap pages, robots, redirects, and both LLM files.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
