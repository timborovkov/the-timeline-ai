import type { NextFetchEvent, NextRequest } from 'next/server';

import { capturePersonlessSurfaceRequest } from '@/lib/analytics';
import { classifyAppAnalyticsPath } from '@/lib/app-analytics-routes';
import { classifyPublicAnalyticsPath } from '@/lib/public-analytics-routes';

function isPrefetch(request: NextRequest): boolean {
  return (
    request.headers.has('next-router-prefetch') ||
    request.headers.has('x-middleware-prefetch') ||
    request.headers.get('purpose')?.toLowerCase() === 'prefetch' ||
    request.headers.get('sec-purpose')?.toLowerCase().includes('prefetch') === true
  );
}

export function isCountableSurfaceNavigation(request: NextRequest): boolean {
  if (request.method !== 'GET' || isPrefetch(request) || request.headers.has('next-action')) {
    return false;
  }
  return (
    request.headers.get('rsc') === '1' ||
    request.headers.get('accept')?.toLowerCase().includes('text/html') === true ||
    request.headers.get('sec-fetch-mode')?.toLowerCase() === 'navigate'
  );
}

function responseAllowsSurfaceCount(response: Response | null): boolean {
  return (
    response === null ||
    (response.status >= 200 && response.status < 300 && !response.headers.has('location'))
  );
}

export function schedulePersonlessSurfaceRequest(
  request: NextRequest,
  response: Response | null,
  context: Pick<NextFetchEvent, 'waitUntil'>,
): void {
  if (!isCountableSurfaceNavigation(request) || !responseAllowsSurfaceCount(response)) return;

  const publicSurface = classifyPublicAnalyticsPath(request.nextUrl.pathname);
  const appSurface = publicSurface ? undefined : classifyAppAnalyticsPath(request.nextUrl.pathname);
  const capture = publicSurface
    ? capturePersonlessSurfaceRequest('public', publicSurface)
    : appSurface
      ? capturePersonlessSurfaceRequest('app', appSurface)
      : null;
  if (capture) context.waitUntil(capture.catch(() => undefined));
}
