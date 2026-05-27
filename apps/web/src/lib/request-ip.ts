import { headers } from 'next/headers';

export async function clientIpFromRequestHeaders(): Promise<string | null> {
  const h = await headers();
  return clientIpFromHeaders(h);
}

export function clientIpFromHeaders(h: Headers): string | null {
  const cf = h.get('cf-connecting-ip');
  if (cf) return cf;
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return h.get('x-real-ip');
}
