import { validateMcpUrl } from '#src/mcp/auth.js';
import {
  crawlPublicWebsiteWithFirecrawl,
  type FirecrawlFetch,
} from '#src/onboarding/firecrawl-website-scan.js';
import {
  parsePublicWebsiteUrl,
  type FirstRunScanFailureReason,
} from '#src/onboarding/first-run.js';

export interface WebsiteScanPage {
  url: string;
  title: string;
  text: string;
}
export type WebsiteScanResult =
  | { ok: true; host: string; pages: WebsiteScanPage[]; providerCredits?: number }
  | { ok: false; reason: FirstRunScanFailureReason; providerCredits?: number };
export interface WebsiteScanDeps {
  crawlId?: string;
  onCrawlStarted?: (crawlId: string) => Promise<void>;
  now?: () => number;
  firecrawlApiKey?: string;
  firecrawlFetch?: FirecrawlFetch;
  sleep?: (ms: number) => Promise<void>;
}

function canonicalizePublicHref(raw: string): URL | null {
  const parsed = parsePublicWebsiteUrl(raw);
  if ('error' in parsed) return null;
  const url = new URL(parsed.href);
  if (validateMcpUrl(url.toString())) return null;
  url.hash = '';
  return url;
}

export function renderWebsitePageContent(page: WebsiteScanPage): string {
  return [page.title, page.url, '', page.text].filter((part) => part.length > 0).join('\n');
}

export async function scanPublicWebsite(
  startUrl: string,
  deps: WebsiteScanDeps = {},
): Promise<WebsiteScanResult> {
  const origin = canonicalizePublicHref(startUrl);
  if (!origin) return { ok: false, reason: 'unreachable' };
  const apiKey = deps.firecrawlApiKey?.trim() ?? '';
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY is required for website scanning.');

  const firecrawl = await crawlPublicWebsiteWithFirecrawl(origin, {
    apiKey,
    ...(deps.crawlId ? { crawlId: deps.crawlId } : {}),
    ...(deps.onCrawlStarted ? { onCrawlStarted: deps.onCrawlStarted } : {}),
    ...(deps.firecrawlFetch ? { fetchImpl: deps.firecrawlFetch } : {}),
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
  });
  if (firecrawl.kind === 'pages') {
    return {
      ok: true,
      host: origin.hostname,
      pages: firecrawl.pages,
      ...(firecrawl.providerCredits === undefined
        ? {}
        : { providerCredits: firecrawl.providerCredits }),
    };
  }
  if (firecrawl.kind === 'failure') {
    return {
      ok: false,
      reason: firecrawl.reason,
      ...(firecrawl.providerCredits === undefined
        ? {}
        : { providerCredits: firecrawl.providerCredits }),
    };
  }
  const error = new Error('Firecrawl is temporarily unavailable. Please retry the website scan.');
  if (firecrawl.retryAfterMs) Object.assign(error, { retryAfterMs: firecrawl.retryAfterMs });
  if (firecrawl.providerRejected) Object.assign(error, { providerRejected: true });
  throw error;
}
