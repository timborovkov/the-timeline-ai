import { NextResponse } from 'next/server';

import type { NextRequest } from 'next/server';

import { nonEmptyEnv } from '@/lib/safe-redirect';

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first === '' ? null : (first ?? null);
}

function canonicalOrigin(): URL | null {
  const origin = nonEmptyEnv(process.env.AUTH_URL) ?? nonEmptyEnv(process.env.NEXTAUTH_URL);
  if (!origin) return null;
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

export function canonicalHostRedirect(request: NextRequest): NextResponse | null {
  if (request.nextUrl.pathname === '/api/health') return null;

  const canonical = canonicalOrigin();
  if (!canonical) return null;

  const currentHost =
    firstHeaderValue(request.headers.get('x-forwarded-host')) ??
    firstHeaderValue(request.headers.get('host')) ??
    request.nextUrl.host;
  const currentProto =
    firstHeaderValue(request.headers.get('x-forwarded-proto')) ??
    request.nextUrl.protocol.replace(/:$/, '');
  const normalizedCurrentProto = currentProto.toLowerCase();

  if (
    currentHost.toLowerCase() === canonical.host.toLowerCase() &&
    `${normalizedCurrentProto}:` === canonical.protocol
  ) {
    return null;
  }

  const target = new URL(request.nextUrl.pathname, canonical.origin);
  target.search = request.nextUrl.search;
  return NextResponse.redirect(target, 308);
}
