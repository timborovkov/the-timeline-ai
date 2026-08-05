import { NextResponse } from 'next/server';

import type { NextRequest } from 'next/server';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Next.js treats multipart POSTs as potential Server Actions and calls
 * `request.formData()` before routing. Malformed scanner traffic
 * (`multipart/form-data` without a boundary, or with an empty body) then
 * throws `TypeError: Failed to parse body as FormData` on `/_not-found`.
 *
 * Reject those requests in the proxy before Next parses the body.
 * See https://github.com/vercel/next.js/issues/81760
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
  return /\bboundary\s*=\s*[^;\s]+/i.test(contentType);
}
