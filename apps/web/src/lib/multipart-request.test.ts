import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';

import {
  hasMultipartBoundary,
  isExplicitZeroContentLength,
  rejectInvalidMultipartRequest,
} from '@/lib/multipart-request';

const ORIGINAL_AUTH_URL = process.env.AUTH_URL;
const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;

afterEach(() => {
  process.env.AUTH_URL = ORIGINAL_AUTH_URL;
  process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
});

function testOrigin(): string {
  const configured = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Fall through to the local test fixture host.
    }
  }
  return 'https://app.timeline.test';
}

function request(init: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
}): NextRequest {
  return new NextRequest(`${testOrigin()}${init.path ?? '/RSC/probe.txt'}`, {
    method: init.method ?? 'POST',
    headers: init.headers,
    body: init.body,
  });
}

describe('hasMultipartBoundary', () => {
  it('accepts a boundary parameter', () => {
    expect(hasMultipartBoundary('multipart/form-data; boundary=----WebKitFormBoundary7MA')).toBe(
      true,
    );
    expect(hasMultipartBoundary('multipart/form-data;boundary="abc"; charset=utf-8')).toBe(true);
  });

  it('rejects multipart without a usable boundary value', () => {
    expect(hasMultipartBoundary('multipart/form-data')).toBe(false);
    expect(hasMultipartBoundary('multipart/form-data; boundary=')).toBe(false);
    expect(hasMultipartBoundary('multipart/form-data; boundary= ;')).toBe(false);
    expect(hasMultipartBoundary('multipart/form-data; boundary=""')).toBe(false);
    expect(hasMultipartBoundary("multipart/form-data; boundary=''")).toBe(false);
    expect(hasMultipartBoundary('multipart/form-data; boundary="')).toBe(false);
    expect(hasMultipartBoundary("multipart/form-data; boundary='")).toBe(false);
    expect(hasMultipartBoundary('multipart/form-data; x-boundary=abc')).toBe(false);
  });
});

describe('isExplicitZeroContentLength', () => {
  it('treats decimal-zero Content-Length values as empty', () => {
    expect(isExplicitZeroContentLength('0')).toBe(true);
    expect(isExplicitZeroContentLength('00')).toBe(true);
    expect(isExplicitZeroContentLength(' 0 ')).toBe(true);
  });

  it('allows missing or non-zero Content-Length', () => {
    expect(isExplicitZeroContentLength(null)).toBe(false);
    expect(isExplicitZeroContentLength('12')).toBe(false);
    expect(isExplicitZeroContentLength('chunked')).toBe(false);
  });
});

describe('rejectInvalidMultipartRequest', () => {
  it('allows non-multipart requests', () => {
    process.env.AUTH_URL = 'https://app.timeline.test';
    expect(
      rejectInvalidMultipartRequest(
        request({ headers: { 'content-type': 'application/json' }, body: '{}' }),
      ),
    ).toBeNull();
    expect(rejectInvalidMultipartRequest(request({ method: 'GET' }))).toBeNull();
  });

  it('rejects multipart without a boundary', () => {
    process.env.AUTH_URL = 'https://app.timeline.test';
    const response = rejectInvalidMultipartRequest(
      request({ headers: { 'content-type': 'multipart/form-data', 'content-length': '12' } }),
    );
    expect(response?.status).toBe(400);
  });

  it('rejects empty or dangling quoted multipart boundaries', () => {
    process.env.AUTH_URL = 'https://app.timeline.test';
    for (const contentType of [
      'multipart/form-data; boundary=""',
      'multipart/form-data; boundary="',
      "multipart/form-data; boundary='",
      'multipart/form-data; x-boundary=abc',
    ]) {
      const response = rejectInvalidMultipartRequest(
        request({
          headers: {
            'content-type': contentType,
            'content-length': '12',
          },
        }),
      );
      expect(response?.status, contentType).toBe(400);
    }
  });

  it('rejects empty multipart bodies for zero Content-Length variants', () => {
    process.env.AUTH_URL = 'https://app.timeline.test';
    for (const contentLength of ['0', '00', ' 0 ']) {
      const response = rejectInvalidMultipartRequest(
        request({
          headers: {
            'content-type': 'multipart/form-data; boundary=----x',
            'content-length': contentLength,
          },
        }),
      );
      expect(response?.status, contentLength).toBe(400);
    }
  });

  it('allows lengthless multipart posts with a usable boundary', () => {
    process.env.AUTH_URL = 'https://app.timeline.test';
    expect(
      rejectInvalidMultipartRequest(
        request({
          headers: { 'content-type': 'multipart/form-data; boundary=----x' },
        }),
      ),
    ).toBeNull();
  });

  it('allows well-formed multipart posts', () => {
    process.env.AUTH_URL = 'https://app.timeline.test';
    const body = '------x\r\nContent-Disposition: form-data; name="a"\r\n\r\nb\r\n------x--\r\n';
    expect(
      rejectInvalidMultipartRequest(
        request({
          headers: {
            'content-type': 'multipart/form-data; boundary=----x',
            'content-length': String(body.length),
          },
          body,
        }),
      ),
    ).toBeNull();
  });

  it('allows chunked multipart without content-length', () => {
    process.env.AUTH_URL = 'https://app.timeline.test';
    expect(
      rejectInvalidMultipartRequest(
        request({
          headers: {
            'content-type': 'multipart/form-data; boundary=----x',
            'transfer-encoding': 'chunked',
          },
        }),
      ),
    ).toBeNull();
  });
});
