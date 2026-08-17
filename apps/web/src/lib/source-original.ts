import {
  isLikelyGeneratedDocumentName,
  truncateFilenameMiddle,
} from '@timeline/shared/documents/presentation';

const INTERNAL_META_KEYS = new Set([
  'source_payload_ref',
  'sourcePayloadRef',
  'payload_ref',
  'raw_payload_ref',
  'source_snapshot_ref',
  'payload_digest',
  'source_payload_digest',
  'raw_payload_digest',
  'source_snapshot_kind',
  'source_snapshot_version',
  'source_snapshot',
  'seed',
  'demo',
  'credential_id',
  'request_headers',
  'auth_config',
  'auth_config_ciphertext',
  'auth_config_iv',
  'auth_config_tag',
]);

const NESTED_PROVIDER_KEYS = [
  'github',
  'linear',
  'sentry',
  'slack',
  'monday',
  'google_drive',
  'jira',
] as const;

const HTML_KEYS = ['html_body', 'htmlBody', 'HtmlBody', 'body_html', 'text_html'] as const;
const TEXT_KEYS = ['text_body', 'textBody', 'TextBody', 'text', 'content_text'] as const;
const FILENAME_KEYS = new Set([
  'filename',
  'file_name',
  'fileName',
  'document_name',
  'stored_name',
  'original_filename',
  'original_name',
  'name',
]);

export interface SourceOriginal {
  label: string;
  text: string | null;
  html: string | null;
  json: unknown | null;
}

export function sourceOriginalFromEvent(input: {
  source: string;
  contentText?: string | null;
  sourceMetadata?: unknown;
}): SourceOriginal {
  const meta = recordValue(input.sourceMetadata);
  const snapshot = recordValue(meta.source_snapshot);
  const html = firstString(
    ...HTML_KEYS.map((key) => meta[key]),
    ...HTML_KEYS.map((key) => snapshot[key]),
    nestedString(meta.raw_postmark, 'HtmlBody'),
    nestedString(snapshot.raw_postmark, 'HtmlBody'),
  );
  const storedText = firstString(
    ...TEXT_KEYS.map((key) => snapshot[key]),
    ...TEXT_KEYS.map((key) => meta[key]),
    nestedString(meta.raw_postmark, 'TextBody'),
    nestedString(snapshot.raw_postmark, 'TextBody'),
  );
  const text = distinctText(html, storedText, html ? input.contentText : null);
  const json = originalJson(meta, snapshot, Boolean(html), Boolean(text));
  return {
    label: originalLabel(input.source, meta, snapshot),
    text,
    html,
    json,
  };
}

export function hasSourceOriginal(original: SourceOriginal): boolean {
  return Boolean(original.html || original.json || original.text);
}

export function framedHtmlDocument(html: string): string {
  const csp =
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; font-src \'none\';">';
  const style =
    '<style>html,body{margin:0;padding:12px;background:transparent;color:#1c1917;font:14px/1.5 ui-sans-serif,system-ui,sans-serif;word-break:break-word;}a{color:inherit}</style>';
  if (/<html[\s>]/i.test(html)) {
    if (/<head[\s>]/i.test(html)) {
      return html.replace(/<head([^>]*)>/i, `<head$1>${csp}${style}`);
    }
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${csp}${style}</head>`);
  }
  return `<!doctype html><html><head>${csp}<meta charset="utf-8">${style}</head><body>${html}</body></html>`;
}

function originalLabel(
  source: string,
  meta: Record<string, unknown>,
  snapshot: Record<string, unknown>,
): string {
  if (source === 'email') return 'Original email';
  if (source === 'slack' || source === 'telegram') return 'Original message';
  if (source === 'meeting') return 'Original transcript';
  if (source === 'ingest_webhook') {
    const name =
      firstString(meta.ingest_webhook_name, meta.webhook_name, snapshot.webhook_name) ?? 'Webhook';
    return `${name} payload`;
  }
  if (source === 'document') return 'Original document event';
  return 'Original payload';
}

function originalJson(
  meta: Record<string, unknown>,
  snapshot: Record<string, unknown>,
  hasHtml: boolean,
  hasText: boolean,
): unknown | null {
  if (Object.keys(snapshot).length > 0) {
    return cleanJson(preferParsedBody(snapshot), hasHtml, hasText);
  }
  for (const key of NESTED_PROVIDER_KEYS) {
    const nested = recordValue(meta[key]);
    if (Object.keys(nested).length > 0) {
      return { [key]: cleanJson(nested, hasHtml, hasText) };
    }
  }
  const leftover = omitKeys(meta, INTERNAL_META_KEYS);
  const cleaned = cleanJson(leftover, hasHtml, hasText);
  return cleaned && Object.keys(recordValue(cleaned)).length > 0 ? cleaned : null;
}

function preferParsedBody(snapshot: Record<string, unknown>): Record<string, unknown> {
  const body = snapshot.body;
  if (typeof body !== 'string') return snapshot;
  const parsed = parseJsonString(body);
  if (parsed === null || parsed === body) return snapshot;
  const next = { ...snapshot };
  next.body = parsed;
  return next;
}

function cleanJson(value: unknown, hasHtml: boolean, hasText: boolean): unknown | null {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => cleanJson(item, hasHtml, hasText))
      .filter((item) => item !== undefined);
    return items.length > 0 ? items : null;
  }
  if (!isRecord(value)) return value === undefined ? null : value;
  const omit = new Set(INTERNAL_META_KEYS);
  if (hasHtml) for (const key of HTML_KEYS) omit.add(key);
  if (hasText) for (const key of TEXT_KEYS) omit.add(key);
  omit.add('raw_postmark');
  const next: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (omit.has(key) || nested === null || nested === undefined || nested === '') continue;
    const cleaned = cleanJson(nested, hasHtml, hasText);
    if (cleaned === null || cleaned === undefined) continue;
    if (isRecord(cleaned) && Object.keys(cleaned).length === 0) continue;
    next[key] = redactFilenameValue(key, cleaned);
  }
  return Object.keys(next).length > 0 ? next : null;
}

function redactFilenameValue(key: string, value: unknown): unknown {
  if (typeof value !== 'string' || !FILENAME_KEYS.has(key)) return value;
  if (
    key === 'name' &&
    !isLikelyGeneratedDocumentName(value) &&
    !/\.[a-z0-9]{2,8}$/i.test(value)
  ) {
    return value;
  }
  return truncateFilenameMiddle(value);
}

function distinctText(
  html: string | null,
  ...candidates: (string | null | undefined)[]
): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (!trimmed || trimmed === html) continue;
    return trimmed;
  }
  return null;
}

function omitKeys(
  record: Record<string, unknown>,
  keys: ReadonlySet<string>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!keys.has(key)) next[key] = value;
  }
  return next;
}

function parseJsonString(value: string): unknown {
  const trimmed = value.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nestedString(value: unknown, key: string): string | null {
  return firstString(recordValue(value)[key]);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}
