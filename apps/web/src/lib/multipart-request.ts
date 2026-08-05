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

  const contentLength = request.headers.get('content-length');
  if (contentLength === '0') {
    return new NextResponse(null, { status: 400 });
  }

  const transferEncoding = request.headers.get('transfer-encoding')?.toLowerCase() ?? '';
  if (!contentLength && !transferEncoding.includes('chunked')) {
    return new NextResponse(null, { status: 400 });
  }

  return null;
}

export function hasMultipartBoundary(contentType: string): boolean {
  const match = /\bboundary\s*=\s*([^;]+)/i.exec(contentType);
  if (!match?.[1]) return false;

  let boundary = match[1].trim();
  if (
    (boundary.startsWith('"') && boundary.endsWith('"')) ||
    (boundary.startsWith("'") && boundary.endsWith("'"))
  ) {
    boundary = boundary.slice(1, -1);
  }

  return boundary.length > 0 && !/[\r\n]/.test(boundary);
}
