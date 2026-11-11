import { validateMcpUrl } from '#src/mcp/auth.js';
import {
  parsePublicWebsiteUrl,
  WEBSITE_SCAN_PAGE_CAP,
  type FirstRunScanFailureReason,
} from '#src/onboarding/first-run.js';

export const FIRECRAWL_API_ORIGIN = 'https://api.firecrawl.dev';
const FIRECRAWL_REQUEST_TIMEOUT_MS = 15_000;
const FIRECRAWL_CRAWL_TIMEOUT_MS = 45_000;
const FIRECRAWL_POLL_INTERVAL_MS = 1_000;
const FIRECRAWL_MIN_TEXT_CHARS = 80;
const FIRECRAWL_MAX_TEXT_CHARS = 20_000;

/**
 * Crawl (not scrape) matches the first-run job: one worker task, persist up to
 * five pages, then the UI polls `team_first_run`. Scrape would need a second
 * discovery pass to pick four extra URLs. `limit: 5`, `maxDiscoveryDepth: 1`,
 * sitemap include, markdown-only (1 credit/page; no JSON mode).
 */
const CRAWL_BODY = {
  limit: WEBSITE_SCAN_PAGE_CAP,
  maxDiscoveryDepth: 1,
  sitemap: 'include',
  allowExternalLinks: false,
  allowSubdomains: false,
  scrapeOptions: { formats: ['markdown'] },
} as const;

interface FirecrawlPage {
  url: string;
  title: string;
  text: string;
}

export type FirecrawlCrawlOutcome =
  | { kind: 'pages'; pages: FirecrawlPage[]; providerCredits?: number }
  | { kind: 'failure'; reason: FirstRunScanFailureReason; providerCredits?: number }
  | { kind: 'retryable'; retryAfterMs?: number; providerRejected?: boolean };

export type FirecrawlFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface FirecrawlCrawlDeps {
  apiKey: string;
  crawlId?: string;
  onCrawlStarted?: (crawlId: string) => Promise<void>;
  fetchImpl?: FirecrawlFetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface FirecrawlDocument {
  markdown?: unknown;
  metadata?: {
    title?: unknown;
    sourceURL?: unknown;
    url?: unknown;
    statusCode?: unknown;
  };
}

interface FirecrawlCrawlStatus {
  id?: unknown;
  status?: unknown;
  data?: unknown;
  error?: unknown;
  next?: unknown;
  creditsUsed?: unknown;
}

interface FirecrawlCrawlErrors {
  errors?: unknown;
  robotsBlocked?: unknown;
}

class FirecrawlRetryableError extends Error {
  readonly retryable = true as const;
  retryAfterMs?: number;
  providerRejected?: boolean;
}

class FirecrawlHttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`Firecrawl HTTP ${String(status)}`);
    this.status = status;
    this.body = body;
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function looksLikeRobots(value: string): boolean {
  return /robots(\.txt)?/i.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizePageUrl(url: URL): string {
  const copy = new URL(url.toString());
  copy.hash = '';
  return copy.toString();
}

function canonicalizePublicHref(raw: string): URL | null {
  const parsed = parsePublicWebsiteUrl(raw);
  if ('error' in parsed) return null;
  const url = new URL(parsed.href);
  if (validateMcpUrl(url.toString())) return null;
  url.hash = '';
  return url;
}

function sameOrigin(left: URL, right: URL): boolean {
  return left.protocol === right.protocol && left.host === right.host;
}

function firecrawlUrl(path: string): string {
  return `${FIRECRAWL_API_ORIGIN}${path}`;
}

function isFirecrawlResultUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.origin === FIRECRAWL_API_ORIGIN && url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function firecrawlJson(
  fetchImpl: FirecrawlFetch,
  url: string,
  init: RequestInit,
  apiKey: string,
): Promise<unknown> {
  let response: Response;
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    if (init.body) headers['Content-Type'] = 'application/json';
    const requestInit: RequestInit = {
      redirect: 'error',
      signal: AbortSignal.timeout(FIRECRAWL_REQUEST_TIMEOUT_MS),
      headers,
    };
    if (init.method) requestInit.method = init.method;
    if (init.body !== undefined && init.body !== null) requestInit.body = init.body;
    response = await fetchImpl(url, requestInit);
  } catch {
    throw new FirecrawlRetryableError('Firecrawl request failed');
  }
  if (isRetryableStatus(response.status)) {
    const error = new FirecrawlRetryableError(`Firecrawl HTTP ${String(response.status)}`);
    if (init.method === 'POST' && response.status === 429) error.providerRejected = true;
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
      if (Number.isFinite(ms) && ms > 0) error.retryAfterMs = ms;
    }
    throw error;
  }
  const body = await response.text();
  if (!response.ok) {
    throw new FirecrawlHttpError(response.status, body);
  }
  if (!body) return {};
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new FirecrawlHttpError(response.status, body);
  }
}

function mapHttpFailure(error: FirecrawlHttpError): FirstRunScanFailureReason {
  if (error.status === 429) return 'rate_limited';
  if (looksLikeRobots(error.body)) return 'robots';
  return 'unreachable';
}

function collectDocuments(data: unknown): FirecrawlDocument[] {
  if (!Array.isArray(data)) return [];
  return data.filter((item): item is FirecrawlDocument => asRecord(item) !== null);
}

function mapDocuments(documents: FirecrawlDocument[], origin: URL): FirecrawlPage[] {
  const pages: FirecrawlPage[] = [];
  const seen = new Set<string>();
  for (const document of documents) {
    const statusCode = asNumber(document.metadata?.statusCode);
    if (statusCode !== null && (statusCode < 200 || statusCode >= 300)) continue;
    const markdown = asString(document.markdown).trim();
    if (markdown.length < FIRECRAWL_MIN_TEXT_CHARS) continue;
    const rawUrl = asString(document.metadata?.sourceURL) || asString(document.metadata?.url);
    const canonical = canonicalizePublicHref(rawUrl);
    if (!canonical || !sameOrigin(canonical, origin)) continue;
    const url = normalizePageUrl(canonical);
    if (seen.has(url)) continue;
    seen.add(url);
    pages.push({
      url,
      title: asString(document.metadata?.title).trim() || canonical.hostname,
      text: markdown.slice(0, FIRECRAWL_MAX_TEXT_CHARS),
    });
    if (pages.length >= WEBSITE_SCAN_PAGE_CAP) break;
  }
  const home = normalizePageUrl(origin);
  const homeIndex = pages.findIndex((page) => page.url === home);
  if (homeIndex > 0) {
    const [homePage] = pages.splice(homeIndex, 1);
    if (homePage) pages.unshift(homePage);
  }
  return pages.slice(0, WEBSITE_SCAN_PAGE_CAP);
}

function robotsBlockedHome(robotsBlocked: unknown, origin: URL): boolean {
  if (!Array.isArray(robotsBlocked)) return false;
  const home = normalizePageUrl(origin);
  return robotsBlocked.some((item) => {
    const canonical = canonicalizePublicHref(asString(item));
    return canonical !== null && normalizePageUrl(canonical) === home;
  });
}

function errorsLookLikeRobots(errors: unknown): boolean {
  if (!Array.isArray(errors)) return false;
  return errors.some((item) => looksLikeRobots(asString(asRecord(item)?.error)));
}

async function readCrawlErrors(
  fetchImpl: FirecrawlFetch,
  crawlId: string,
  apiKey: string,
): Promise<FirecrawlCrawlErrors> {
  try {
    const payload = await firecrawlJson(
      fetchImpl,
      firecrawlUrl(`/v2/crawl/${encodeURIComponent(crawlId)}/errors`),
      { method: 'GET' },
      apiKey,
    );
    const record = asRecord(payload);
    return {
      errors: record?.errors,
      robotsBlocked: record?.robotsBlocked,
    };
  } catch {
    return {};
  }
}

async function collectStatusPages(
  fetchImpl: FirecrawlFetch,
  startUrl: string,
  apiKey: string,
): Promise<{ status: FirecrawlCrawlStatus; documents: FirecrawlDocument[] }> {
  const documents: FirecrawlDocument[] = [];
  let nextUrl: string | null = startUrl;
  let status: FirecrawlCrawlStatus = {};
  const seen = new Set<string>();
  while (nextUrl && isFirecrawlResultUrl(nextUrl) && !seen.has(nextUrl)) {
    seen.add(nextUrl);
    const payload = await firecrawlJson(fetchImpl, nextUrl, { method: 'GET' }, apiKey);
    const record = asRecord(payload) ?? {};
    status = {
      id: record.id,
      status: record.status,
      data: record.data,
      error: record.error,
      next: record.next,
    };
    documents.push(...collectDocuments(record.data));
    const following = asString(record.next);
    nextUrl = following.length > 0 && isFirecrawlResultUrl(following) ? following : null;
    if (asString(status.status) !== 'completed' && documents.length >= WEBSITE_SCAN_PAGE_CAP) {
      break;
    }
    if (asString(status.status) === 'completed' && !nextUrl) break;
    if (asString(status.status) !== 'completed') break;
  }
  return { status, documents };
}

export async function crawlPublicWebsiteWithFirecrawl(
  origin: URL,
  deps: FirecrawlCrawlDeps,
): Promise<FirecrawlCrawlOutcome> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? sleepMs;
  const startedAt = now();
  const deadlineExceeded = () => now() - startedAt >= FIRECRAWL_CRAWL_TIMEOUT_MS;

  try {
    let crawlId = deps.crawlId;
    if (!crawlId) {
      const started = await firecrawlJson(
        fetchImpl,
        firecrawlUrl('/v2/crawl'),
        {
          method: 'POST',
          body: JSON.stringify({ url: origin.toString(), ...CRAWL_BODY }),
        },
        deps.apiKey,
      );
      crawlId = asString(asRecord(started)?.id);
      if (!crawlId) return { kind: 'retryable' };
      try {
        await deps.onCrawlStarted?.(crawlId);
      } catch (error) {
        // Do not knowingly leave untracked provider work when checkpointing fails.
        await firecrawlJson(
          fetchImpl,
          firecrawlUrl(`/v2/crawl/${encodeURIComponent(crawlId)}`),
          { method: 'DELETE' },
          deps.apiKey,
        );
        throw error;
      }
    }

    let lastDocuments: FirecrawlDocument[] = [];
    while (!deadlineExceeded()) {
      const page = await collectStatusPages(
        fetchImpl,
        firecrawlUrl(`/v2/crawl/${encodeURIComponent(crawlId)}`),
        deps.apiKey,
      );
      lastDocuments = page.documents;
      const status = asString(page.status.status);
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        const errors = await readCrawlErrors(fetchImpl, crawlId, deps.apiKey);
        const pages = mapDocuments(lastDocuments, origin);
        const blockedHome = robotsBlockedHome(errors.robotsBlocked, origin);
        const robotsError =
          blockedHome ||
          errorsLookLikeRobots(errors.errors) ||
          looksLikeRobots(asString(page.status.error));
        const usage =
          typeof page.status.creditsUsed === 'number' &&
          Number.isSafeInteger(page.status.creditsUsed) &&
          page.status.creditsUsed >= 0
            ? { providerCredits: page.status.creditsUsed }
            : {};
        if (pages.length > 0)
          return {
            kind: 'pages',
            pages,
            ...(typeof page.status.creditsUsed === 'number' &&
            Number.isSafeInteger(page.status.creditsUsed) &&
            page.status.creditsUsed >= 0
              ? { providerCredits: page.status.creditsUsed }
              : {}),
          };
        if (robotsError) return { kind: 'failure', reason: 'robots', ...usage };
        if (status === 'failed' || status === 'cancelled') {
          return { kind: 'failure', reason: 'unreachable', ...usage };
        }
        return { kind: 'failure', reason: 'no_readable_text', ...usage };
      }
      await sleep(FIRECRAWL_POLL_INTERVAL_MS);
    }
    return { kind: 'retryable' };
  } catch (error) {
    if (error instanceof FirecrawlRetryableError)
      return {
        kind: 'retryable',
        ...(error.retryAfterMs ? { retryAfterMs: error.retryAfterMs } : {}),
        ...(error.providerRejected ? { providerRejected: true } : {}),
      };
    if (error instanceof FirecrawlHttpError) {
      return { kind: 'failure', reason: mapHttpFailure(error) };
    }
    return { kind: 'retryable' };
  }
}

export async function cancelWebsiteCrawl(crawlId: string, apiKey: string): Promise<void> {
  await firecrawlJson(
    fetch,
    firecrawlUrl(`/v2/crawl/${encodeURIComponent(crawlId)}`),
    { method: 'DELETE' },
    apiKey,
  );
}
