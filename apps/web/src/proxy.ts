import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import NextAuth from 'next-auth';

import { migrateLegacyActiveTeamCookie } from '@/lib/active-team-cookie-migration';
import { authConfig } from '@/lib/auth.config';
import { canonicalHostRedirect } from '@/lib/canonical-host';
import { connectionsLegacyRedirectLocation } from '@/lib/connections';
import { contentSecurityPolicyHeaders } from '@/lib/content-security-policy';
import { rejectInvalidMultipartRequest } from '@/lib/multipart-request';
import { platformRequestGate } from '@/lib/platform-request-gate';
import {
  hasOversizedContentLength,
  payloadTooLargeResponse,
  REQUEST_BODY_LIMITS,
} from '@/lib/request-body';
import { protectSensitiveLinkResponse } from '@/lib/sensitive-links';
import { schedulePersonlessSurfaceRequest } from '@/lib/surface-request-analytics';

type ProxyHandler = (
  request: NextRequest,
  context: NextFetchEvent,
) => Response | null | Promise<Response | null>;

const authProxy = NextAuth(authConfig).auth(async (request) => {
  const denied = await platformRequestGate(request, request.auth);
  if (denied) return denied;
  if (request.auth?.user && request.method === 'POST') {
    const path = request.nextUrl.pathname;
    const limit =
      path === '/api/chat'
        ? REQUEST_BODY_LIMITS.chat
        : path === '/api/search/global'
          ? REQUEST_BODY_LIMITS.globalSearch
          : undefined;
    if (limit && hasOversizedContentLength(request, limit)) return payloadTooLargeResponse();
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-timeline-path', request.nextUrl.pathname);
  requestHeaders.set('x-timeline-method', request.method);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    for (const { key, value } of contentSecurityPolicyHeaders(process.env)) {
      response.headers.set(key, value);
    }
  }
  await migrateLegacyActiveTeamCookie(request, response);
  return response;
}) as unknown as ProxyHandler;

export const proxy: ProxyHandler = async (request, context) => {
  const redirect = canonicalHostRedirect(request);
  if (redirect) return protectSensitiveLinkResponse(redirect, request.nextUrl.pathname);
  const connectionsLocation = connectionsLegacyRedirectLocation(
    request.nextUrl.pathname,
    request.nextUrl.searchParams,
  );
  if (connectionsLocation) {
    return NextResponse.redirect(new URL(connectionsLocation, request.url), 308);
  }
  const invalidMultipart = rejectInvalidMultipartRequest(request);
  if (invalidMultipart)
    return protectSensitiveLinkResponse(invalidMultipart, request.nextUrl.pathname);
  const response = await authProxy(request, context);
  schedulePersonlessSurfaceRequest(request, response, context);
  return protectSensitiveLinkResponse(response, request.nextUrl.pathname);
};

export const config = {
  matcher: [
    '/((?!api/health|sentry-tunnel|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
