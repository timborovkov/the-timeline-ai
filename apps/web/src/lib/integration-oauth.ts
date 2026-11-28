import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { NATIVE_PROVIDER_IDS, type NativeProviderId } from '@timeline/db/integration-providers';
import { requireAuthSecret } from '@timeline/shared/env';
import { z } from 'zod';

import { appUrl } from '@/lib/site-url';

export function integrationOAuthRedirectUri(provider: NativeProviderId): string {
  return appUrl(`/api/integrations/${provider}/callback`).toString();
}

const stateSchema = z.object({
  teamId: z.uuid(),
  userId: z.uuid(),
  provider: z.enum(NATIVE_PROVIDER_IDS),
  nonce: z.string(),
  iat: z.number(),
});

export function signIntegrationOAuthState(
  teamId: string,
  userId: string,
  provider: NativeProviderId,
): string {
  const secret = requireAuthSecret();
  const payload = stateSchema.parse({
    teamId,
    userId,
    provider,
    nonce: randomBytes(16).toString('base64url'),
    iat: Date.now(),
  });
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifyIntegrationOAuthState(state: string): z.infer<typeof stateSchema> | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;
  const expected = createHmac('sha256', requireAuthSecret()).update(payloadB64).digest('base64url');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sigB64, 'utf8');
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const parsed = stateSchema.parse(payload);
    // Reject expired state. The start route mints iat as Date.now() (ms);
    // the 15-minute window mirrors the MCP-side oauth-state JWT and is
    // long enough for a user to complete the upstream OAuth dance but
    // short enough to bound replay/fixation.
    const ageMs = Date.now() - parsed.iat;
    if (ageMs < 0 || ageMs > 15 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}
