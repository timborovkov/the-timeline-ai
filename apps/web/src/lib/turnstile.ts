import { randomUUID } from 'node:crypto';

import { getEnv } from '@timeline/shared/env';
import { childLogger } from '@timeline/shared/logger';

const log = childLogger('web:turnstile');

interface SiteverifyResponse {
  success?: boolean;
  'error-codes'?: string[];
  action?: string;
  hostname?: string;
}

export async function verifyTurnstileToken(input: {
  token: FormDataEntryValue | null;
  remoteIp?: string | null;
  expectedAction?: string;
  expectedHostname?: string | null;
}): Promise<boolean> {
  const env = getEnv();
  if (!env.TURNSTILE_SECRET_KEY) return env.NODE_ENV !== 'production';
  if (typeof input.token !== 'string' || input.token.length === 0 || input.token.length > 2048) {
    return false;
  }

  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET_KEY);
  body.append('response', input.token);
  body.append('idempotency_key', randomUUID());
  if (input.remoteIp) body.append('remoteip', input.remoteIp);

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      body,
    });
    const data = (await res.json()) as SiteverifyResponse;
    if (!data.success) {
      log.warn({ errors: data['error-codes'] ?? [] }, 'turnstile verification failed');
      return false;
    }
    if (input.expectedAction && data.action !== input.expectedAction) {
      log.warn(
        { expected: input.expectedAction, received: data.action },
        'turnstile action mismatch',
      );
      return false;
    }
    if (input.expectedHostname && data.hostname !== input.expectedHostname) {
      log.warn(
        { expected: input.expectedHostname, received: data.hostname },
        'turnstile hostname mismatch',
      );
      return false;
    }
    return true;
  } catch (err) {
    log.warn({ err }, 'turnstile verification request failed');
    return false;
  }
}

export function turnstileHostnameFromHeaders(headers: Headers): string | null {
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!host) return null;
  const firstHost = host.split(',')[0]?.trim();
  if (!firstHost) return null;
  try {
    return new URL(`https://${firstHost}`).hostname;
  } catch {
    return null;
  }
}
