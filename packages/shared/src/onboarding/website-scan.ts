import { ExternalHttpError, externalFetch } from '#src/http/external-fetch.js';
import { validateMcpUrl } from '#src/mcp/auth.js';
import {
  parsePublicWebsiteUrl,
  WEBSITE_SCAN_PAGE_CAP,
  type FirstRunScanFailureReason,
} from '#src/onboarding/first-run.js';

export const WEBSITE_SCAN_USER_AGENT = 'TimelineBot/1.0 (first-run website scan)';
const WEBSITE_SCAN_REQUEST_TIMEOUT_MS = 8_000;
const WEBSITE_SCAN_TOTAL_TIMEOUT_MS = 25_000;
const WEBSITE_SCAN_MAX_BYTES = 512 * 1024;
const WEBSITE_SCAN_MIN_TEXT_CHARS = 80;
const WEBSITE_SCAN_MAX_REDIRECTS = 3;

const PREFERRED_PATH_HINTS = [
  'about',
  'about-us',
  'pricing',
  'product',
  'products',
  'services',
  'team',
  'company',
] as const;

export interface WebsiteScanPage {
  url: string;
  title: string;
  text: string;
}

export type WebsiteScanResult =
  | { ok: true; host: string; pages: WebsiteScanPage[] }
  | { ok: false; reason: FirstRunScanFailureReason };

export type WebsiteScanFetch = typeof externalFetch;

export interface WebsiteScanDeps {
  fetchPage?: WebsiteScanFetch;
  now?: () => number;
}

interface RobotsRule {
  allow: boolean;
  path: string;
}

interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

export function parseRobotsTxt(body: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let startingGroup = true;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) {
      current = null;
      startingGroup = true;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!current || !startingGroup) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      startingGroup = true;
      continue;
    }
    startingGroup = false;
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      current.rules.push({ allow: field === 'allow', path: value || '/' });
    }
  }
  return groups;
}

function userAgentToken(userAgent: string): string {
  return userAgent.split(/[/\s]/)[0]?.toLowerCase() ?? 'timelinebot';
}

export function robotsAllowsPath(
  groups: RobotsGroup[],
  userAgent: string,
  pathAndQuery: string,
): boolean {
  const token = userAgentToken(userAgent);
  const specific = groups.filter((group) => group.agents.includes(token));
  const wildcard = groups.filter((group) => group.agents.includes('*'));
  const matched = specific.length > 0 ? specific : wildcard;
  if (matched.length === 0) return true;
  const path = pathAndQuery.length > 0 ? pathAndQuery : '/';
  let winner: { allow: boolean; length: number } | null = null;
  for (const group of matched) {
    for (const rule of group.rules) {
      if (!path.startsWith(rule.path)) continue;
      const length = rule.path.length;
      if (!winner || length > winner.length || (length === winner.length && rule.allow)) {
        winner = { allow: rule.allow, length };
      }
    }
  }
  return winner?.allow ?? true;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    );
}

export function htmlToReadableText(html: string): { title: string; text: string } {
  const title = decodeEntities(
    (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(?:br|p|div|h[1-6]|li|tr|section|article|header|footer)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(stripped)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return { title, text };
}

function canonicalizePublicHref(raw: string): URL | null {
  const parsed = parsePublicWebsiteUrl(raw);
  if ('error' in parsed) return null;
  const url = new URL(parsed.href);
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (validateMcpUrl(url.toString())) return null;
  url.hash = '';
  return url;
}

function sameOrigin(left: URL, right: URL): boolean {
  return left.protocol === right.protocol && left.host === right.host;
}

function normalizePageUrl(url: URL): string {
  const copy = new URL(url.toString());
  copy.hash = '';
  if (copy.pathname !== '/' && copy.pathname.endsWith('/')) {
    copy.pathname = copy.pathname.slice(0, -1);
  }
  return copy.toString();
}

function isSkippableHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('?')) return true;
  const lower = trimmed.toLowerCase();
  return (
    lower.startsWith('mailto:') ||
    lower.startsWith('javascript:') ||
    lower.startsWith('tel:') ||
    lower.startsWith('data:')
  );
}

function looksLikeHtmlPath(pathname: string): boolean {
  const last = pathname.split('/').pop() ?? '';
  if (!last.includes('.')) return true;
  return /\.(html?|php|asp|aspx|xhtml)$/i.test(last);
}

function preferredRank(pathname: string): number {
  const segments = pathname.toLowerCase().split('/').filter(Boolean);
  const index = PREFERRED_PATH_HINTS.findIndex((hint) => segments.includes(hint));
  return index === -1 ? PREFERRED_PATH_HINTS.length : index;
}

export function discoverSameOriginPages(html: string, base: URL): string[] {
  const found = new Map<string, number>();
  const hrefRe = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const match of html.matchAll(hrefRe)) {
    const href = match[1] ?? match[2] ?? match[3] ?? '';
    if (isSkippableHref(href)) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }
    if (!sameOrigin(resolved, base) || !looksLikeHtmlPath(resolved.pathname)) continue;
    const canonical = canonicalizePublicHref(resolved.toString());
    if (!canonical || !sameOrigin(canonical, base)) continue;
    const key = normalizePageUrl(canonical);
    if (!found.has(key)) found.set(key, preferredRank(canonical.pathname));
  }
  return [...found.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([url]) => url);
}

function isHtmlResponse(response: Response): boolean {
  const type = response.headers.get('content-type')?.toLowerCase() ?? '';
  return (
    type.length === 0 ||
    type.includes('html') ||
    type.includes('xml') ||
    type.includes('text/plain')
  );
}

async function fetchPageResponse(fetchPage: WebsiteScanFetch, url: URL): Promise<Response> {
  return fetchPage(
    url,
    {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'User-Agent': WEBSITE_SCAN_USER_AGENT,
      },
    },
    {
      timeoutMs: WEBSITE_SCAN_REQUEST_TIMEOUT_MS,
      maxResponseBytes: WEBSITE_SCAN_MAX_BYTES,
      retries: 0,
    },
  );
}

async function followSameOrigin(
  fetchPage: WebsiteScanFetch,
  start: URL,
  origin: URL,
): Promise<Response | null> {
  let current = start;
  for (let hop = 0; hop <= WEBSITE_SCAN_MAX_REDIRECTS; hop += 1) {
    const response = await fetchPageResponse(fetchPage, current);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return null;
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return null;
    }
    const canonical = canonicalizePublicHref(next.toString());
    if (!canonical || !sameOrigin(canonical, origin)) return null;
    current = canonical;
  }
  return null;
}

async function loadRobots(
  fetchPage: WebsiteScanFetch,
  origin: URL,
): Promise<RobotsGroup[] | 'blocked' | 'unknown'> {
  const robotsUrl = canonicalizePublicHref(new URL('/robots.txt', origin).toString());
  if (!robotsUrl) return 'unknown';
  try {
    const response = await fetchPageResponse(fetchPage, robotsUrl);
    if (response.status === 404 || response.status === 410) return [];
    if (response.status < 200 || response.status >= 300) return 'unknown';
    const body = await response.text();
    const groups = parseRobotsTxt(body);
    if (!robotsAllowsPath(groups, WEBSITE_SCAN_USER_AGENT, '/')) return 'blocked';
    return groups;
  } catch (error) {
    if (error instanceof ExternalHttpError && error.code === 'blocked_address') return 'blocked';
    return 'unknown';
  }
}

function mapFetchFailure(error: unknown): FirstRunScanFailureReason {
  if (error instanceof ExternalHttpError && error.code === 'blocked_address') return 'unreachable';
  return 'unreachable';
}

export function renderWebsitePageContent(page: WebsiteScanPage): string {
  return [page.title, page.url, '', page.text].filter((part) => part.length > 0).join('\n');
}

export async function scanPublicWebsite(
  startUrl: string,
  deps: WebsiteScanDeps = {},
): Promise<WebsiteScanResult> {
  const fetchPage = deps.fetchPage ?? externalFetch;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const parsedOrigin = canonicalizePublicHref(startUrl);
  if (!parsedOrigin) return { ok: false, reason: 'unreachable' };
  const origin: URL = parsedOrigin;

  const deadlineExceeded = () => now() - startedAt >= WEBSITE_SCAN_TOTAL_TIMEOUT_MS;
  const robots = await loadRobots(fetchPage, origin);
  if (robots === 'blocked') return { ok: false, reason: 'robots' };
  const groups = robots === 'unknown' ? [] : robots;
  const homePath = `${origin.pathname}${origin.search}` || '/';
  if (groups.length > 0 && !robotsAllowsPath(groups, WEBSITE_SCAN_USER_AGENT, homePath)) {
    return { ok: false, reason: 'robots' };
  }

  const pages: WebsiteScanPage[] = [];
  const seen = new Set<string>();

  async function readPage(
    url: URL,
  ): Promise<{ page: WebsiteScanPage; html: string } | 'robots' | 'skip'> {
    const key = normalizePageUrl(url);
    if (seen.has(key)) return 'skip';
    seen.add(key);
    const path = `${url.pathname}${url.search}` || '/';
    if (groups.length > 0 && !robotsAllowsPath(groups, WEBSITE_SCAN_USER_AGENT, path)) {
      return 'robots';
    }
    if (deadlineExceeded()) return 'skip';
    let response: Response | null;
    try {
      response = await followSameOrigin(fetchPage, url, origin);
    } catch (error) {
      if (error instanceof ExternalHttpError && error.code === 'blocked_address') throw error;
      return 'skip';
    }
    if (!response || response.status < 200 || response.status >= 300 || !isHtmlResponse(response)) {
      return 'skip';
    }
    const html = await response.text();
    const readable = htmlToReadableText(html);
    if (readable.text.length < WEBSITE_SCAN_MIN_TEXT_CHARS) return 'skip';
    return {
      html,
      page: {
        url: key,
        title: readable.title || url.hostname,
        text: readable.text.slice(0, 20_000),
      },
    };
  }

  let home: { page: WebsiteScanPage; html: string } | 'robots' | 'skip';
  try {
    home = await readPage(origin);
  } catch (error) {
    return { ok: false, reason: mapFetchFailure(error) };
  }
  if (home === 'robots') return { ok: false, reason: 'robots' };
  if (home === 'skip') return { ok: false, reason: 'no_readable_text' };
  pages.push(home.page);

  try {
    const candidates = discoverSameOriginPages(home.html, origin).filter(
      (href) => href !== normalizePageUrl(origin),
    );
    for (const href of candidates) {
      if (pages.length >= WEBSITE_SCAN_PAGE_CAP || deadlineExceeded()) break;
      const url = canonicalizePublicHref(href);
      if (!url) continue;
      const page = await readPage(url);
      if (page === 'robots' || page === 'skip') continue;
      pages.push(page.page);
    }
  } catch (error) {
    if (pages.length === 0) return { ok: false, reason: mapFetchFailure(error) };
  }

  if (pages.length === 0) return { ok: false, reason: 'no_readable_text' };
  return { ok: true, host: origin.hostname, pages: pages.slice(0, WEBSITE_SCAN_PAGE_CAP) };
}
