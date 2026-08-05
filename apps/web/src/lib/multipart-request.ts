import { NextResponse } from 'next/server';

import type { NextRequest } from 'next/server';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * App Router Server Action handling treats multipart POSTs as potential
 * actions and calls `request.formData()` before routing finishes. Malformed
 * scanner traffic (`multipart/form-data` without a usable boundary, or with
 * an empty body) then throws `TypeError: Failed to parse body as FormData`
 * on `/_not-found` (see production THE-TIMELINE-AI-29:
 * `POST /_not-found/page`).
 *
 * Reject those requests in the proxy before Next parses the body.
 * Upstream tracking: https://github.com/vercel/next.js/issues/81760
 * (mislabeled Pages Router; author confirmed App Router, and Next 16's
 * `action-handler` still calls `formData()` for App Router multipart POSTs).
 *
 * Only reject clearly invalid headers (missing/empty boundary, explicit zero
 * Content-Length). Do not require Content-Length — HTTP/2 and some proxies
 * omit it for legitimate Server Action form posts.
 */
export function rejectInvalidMultipartRequest(request: NextRequest): NextResponse | null {
  if (!BODY_METHODS.has(request.method)) return null;

  const contentType = request.headers.get('content-type');
  if (!contentType?.toLowerCase().startsWith('multipart/form-data')) {
    return null;
  }

  if (!hasMultipartBoundary(contentType)) {
    return new NextResponse(null, { status: 400 });
  }

  if (isExplicitZeroContentLength(request.headers.get('content-length'))) {
    return new NextResponse(null, { status: 400 });
  }

  return null;
}

export function hasMultipartBoundary(contentType: string): boolean {
  // Require the exact `boundary` parameter name (not `x-boundary`, etc.).
  const match = /(?:^|;)\s*boundary\s*=\s*([^;]*)/i.exec(contentType);
  if (!match) return false;

  const raw = match[1]?.trim() ?? '';
  if (!raw) return false;

  const quote = raw[0];
  if (quote === '"' || quote === "'") {
    if (raw.length < 2 || !raw.endsWith(quote)) return false;
    const unquoted = raw.slice(1, -1);
    return unquoted.length > 0 && !/[\r\n]/.test(unquoted);
  }

  // Unquoted values must not contain quote characters.
  if (raw.includes('"') || raw.includes("'")) return false;
  return !/[\r\n]/.test(raw);
}

export function isExplicitZeroContentLength(contentLength: string | null): boolean {
  if (contentLength === null) return false;
  const trimmed = contentLength.trim();
  if (!/^\d+$/.test(trimmed)) return false;
  return Number(trimmed) === 0;
}
