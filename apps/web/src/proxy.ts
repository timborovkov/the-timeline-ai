import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import NextAuth from 'next-auth';

import { migrateLegacyActiveTeamCookie } from '@/lib/active-team-cookie-migration';
import { authConfig } from '@/lib/auth.config';
import { canonicalHostRedirect } from '@/lib/canonical-host';
import { rejectInvalidMultipartRequest } from '@/lib/multipart-request';
import { platformRequestGate } from '@/lib/platform-request-gate';
import { schedulePersonlessSurfaceRequest } from '@/lib/surface-request-analytics';

type ProxyHandler = (
  request: NextRequest,
  context: NextFetchEvent,
) => Response | null | Promise<Response | null>;

const authProxy = NextAuth(authConfig).auth(async (request) => {
  const denied = await platformRequestGate(request, request.auth);
  if (denied) return denied;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-timeline-path', request.nextUrl.pathname);
  requestHeaders.set('x-timeline-method', request.method);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  await migrateLegacyActiveTeamCookie(request, response);
  return response;
}) as unknown as ProxyHandler;

export const proxy: ProxyHandler = async (request, context) => {
  const redirect = canonicalHostRedirect(request);
  if (redirect) return redirect;
  const invalidMultipart = rejectInvalidMultipartRequest(request);
  if (invalidMultipart) return invalidMultipart;
  const response = await authProxy(request, context);
  schedulePersonlessSurfaceRequest(request, response, context);
  return response;
};

export const config = {
  matcher: [
    '/((?!api/health|sentry-tunnel|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
