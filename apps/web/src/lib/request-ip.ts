import { clientIpFromHeaders as sharedClientIpFromHeaders } from '@timeline/shared/email';

export function clientIpFromHeaders(h: Headers): string | null {
  return sharedClientIpFromHeaders(h);
}
