/** Extract the client IP from common proxy headers. Prefer Cloudflare, then first entry of XFF. */
export function clientIpFromHeaders(headers: Headers): string | null {
  const cf = headers.get('cf-connecting-ip');
  if (cf) {
    const trimmed = cf.trim();
    if (trimmed) return trimmed;
  }
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers.get('x-real-ip');
  if (real) return real.trim();
  return null;
}
