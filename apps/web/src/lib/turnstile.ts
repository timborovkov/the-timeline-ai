import { randomUUID } from 'node:crypto';

import { getEnv } from '@timeline/shared/env';
import { childLogger } from '@timeline/shared/logger';

const log = childLogger('web:turnstile');

interface SiteverifyResponse {
  success?: boolean;
  'error-codes'?: string[];
}

export async function verifyTurnstileToken(input: {
  token: FormDataEntryValue | null;
  remoteIp?: string | null;
}): Promise<boolean> {
  const env = getEnv();
  if (!env.TURNSTILE_SECRET_KEY) return env.NODE_ENV !== 'production';
  if (typeof input.token !== 'string' || input.token.length === 0) return false;

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
    if (data.success) return true;
    log.warn({ errors: data['error-codes'] ?? [] }, 'turnstile verification failed');
    return false;
  } catch (err) {
    log.warn({ err }, 'turnstile verification request failed');
    return false;
  }
}
