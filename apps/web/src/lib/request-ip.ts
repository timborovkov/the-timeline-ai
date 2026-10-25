import { isIP } from 'node:net';

import { clientIpFromHeaders as sharedClientIpFromHeaders } from '@timeline/shared/email';

function normalizedIp(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed && isIP(trimmed) !== 0 ? trimmed : null;
}

/**
 * Railway overwrites `X-Real-IP` at its public proxy, so production security
 * buckets trust only that injected value. Development keeps the shared proxy
 * fallback for local reverse-proxy testing; callers otherwise share their
 * explicit `unknown` bucket instead of accepting spoofable forwarding input.
 */
export function clientIpFromHeaders(h: Headers): string | null {
  const railwayIp = normalizedIp(h.get('x-real-ip'));
  if (railwayIp) return railwayIp;
  if (process.env.NODE_ENV === 'production') return null;
  return normalizedIp(sharedClientIpFromHeaders(h));
}
