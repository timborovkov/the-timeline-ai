import { clientIpFromHeaders as sharedClientIpFromHeaders } from '@timeline/shared/email';
import { headers } from 'next/headers';

export async function clientIpFromRequestHeaders(): Promise<string | null> {
  const h = await headers();
  return clientIpFromHeaders(h);
}

export function clientIpFromHeaders(h: Headers): string | null {
  return sharedClientIpFromHeaders(h);
}
