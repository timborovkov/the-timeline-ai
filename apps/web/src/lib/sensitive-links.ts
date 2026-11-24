const sensitiveRoutePatterns = [
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/accept-invite',
  '/guest',
  '/sign-in',
  '/sign-up',
  '/legal/accept',
  '/oauth',
  '/api/auth',
  '/api/calendar/feed',
  '/api/team/calendar-subscription',
  '/api/mcp/oauth',
  '/api/slack/install',
  '/api/slack/user-link',
  '/api/webhooks/ingest',
  '/api/webhooks/monday',
] as const;

const integrationCallback = '/api/integrations/:provider/callback';

export const sensitiveLinkHeaderSources = [
  ...sensitiveRoutePatterns.map((path) => `${path}/:path*`),
  integrationCallback,
];

// Native form POSTs from no-referrer documents send Origin: null in Chromium,
// which correctly fails Server Action CSRF checks. Send only the origin so URL
// paths and query tokens remain private without weakening origin validation.
export const sensitiveLinkReferrerPolicy = 'strict-origin';

export const sensitiveLinkHeaders = [
  { key: 'Cache-Control', value: 'no-store' },
  { key: 'Referrer-Policy', value: sensitiveLinkReferrerPolicy },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
] as const;

export const sensitiveLinkRequestLogPattern = new RegExp(
  `^(?:https?://[^/]+)?(?:${sensitiveRoutePatterns.join('|')}|/api/integrations/[^/?]+/callback)(?:[/?]|$)`,
  'i',
);

export function protectSensitiveLinkResponse(response: Response | null, pathname: string) {
  if (!response || !sensitiveLinkRequestLogPattern.test(pathname)) return response;
  // Response.redirect() returns immutable headers. Retain the NextResponse
  // subclass for pass-through responses and clone only plain responses.
  const protectedResponse =
    response.constructor === Response ? new Response(response.body, response) : response;
  for (const { key, value } of sensitiveLinkHeaders) protectedResponse.headers.set(key, value);
  return protectedResponse;
}
