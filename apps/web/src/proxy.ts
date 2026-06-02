import NextAuth from 'next-auth';

import type { NextFetchEvent, NextRequest } from 'next/server';

import { authConfig } from '@/lib/auth.config';
import { canonicalHostRedirect } from '@/lib/canonical-host';

type ProxyHandler = (
  request: NextRequest,
  context: NextFetchEvent,
) => Response | null | Promise<Response | null>;

const authProxy = NextAuth(authConfig).auth as unknown as ProxyHandler;

export const proxy: ProxyHandler = (request, context) => {
  const redirect = canonicalHostRedirect(request);
  if (redirect) return redirect;
  return authProxy(request, context);
};

export const config = {
  matcher: [
    '/((?!api/health|sentry-tunnel|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
