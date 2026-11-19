import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  parseOnboardingSourceIntent,
  type OnboardingSourceIntent,
} from '@timeline/shared/onboarding/first-run';
import { cookies } from 'next/headers';

import { nonEmptyEnv } from '@/lib/safe-redirect';

export {
  orderChooserSources,
  parseOnboardingSourceIntent,
  type OnboardingSourceIntent,
} from '@timeline/shared/onboarding/first-run';

const COOKIE_NAME = 'tl_onboarding_source';
const TTL_MS = 30 * 60 * 1000;

interface SignedPayload {
  intent: OnboardingSourceIntent;
  exp: number;
}

function getSecret(): string | null {
  return nonEmptyEnv(process.env.AUTH_SECRET) ?? nonEmptyEnv(process.env.NEXTAUTH_SECRET) ?? null;
}

function sign(payload: SignedPayload): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(value: string): OnboardingSourceIntent | null {
  const secret = getSecret();
  if (!secret) return null;
  const dot = value.indexOf('.');
  if (dot < 0) return null;
  const body = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parsed: { intent?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      intent?: unknown;
      exp?: unknown;
    };
  } catch {
    return null;
  }
  if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
  return parseOnboardingSourceIntent(parsed.intent);
}

/** Stash marketing source intent across sign-up / OAuth before first-run chooser. */
export async function setOnboardingSourceIntent(intent: OnboardingSourceIntent): Promise<void> {
  const value = sign({ intent, exp: Date.now() + TTL_MS });
  if (!value) return;
  const jar = await cookies();
  jar.set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TTL_MS / 1000,
  });
}

export async function readOnboardingSourceIntent(): Promise<OnboardingSourceIntent | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return verify(raw);
}

export async function clearOnboardingSourceIntent(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export function onboardingCallbackForSource(intent: OnboardingSourceIntent): string {
  return `/onboarding?source=${intent}`;
}
