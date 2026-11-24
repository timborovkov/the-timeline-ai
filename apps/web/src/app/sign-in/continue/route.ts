import { signedInAuthRedirect } from '@/lib/auth-redirect';

export function GET(request: Request): Response {
  // The exact-file Doctor exception covers its client-prefill heuristic: this server
  // route only navigates after same-origin/auth-loop validation; it grants no access.
  const callbackUrl = new URL(request.url).searchParams.get('callbackUrl') ?? undefined;
  const destination = signedInAuthRedirect({ callbackUrl })
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

  // A document response prevents the sign-in action from streaming the destination
  // with the wrong cookie paths. The browser sends its scoped cookies on the next GET.
  return new Response(
    `<!doctype html><html lang="en"><head><title>Continue to The Timeline</title><meta http-equiv="refresh" content="0;url=${destination}"></head><body><main><a href="${destination}">Continue to The Timeline</a></main></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
