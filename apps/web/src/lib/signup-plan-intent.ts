import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { paidSignupPlan, type PaidSignupPlanId } from '@/lib/signup-plan';
import { isPrefetchRequest } from '@/lib/surface-request-analytics';

export const PLAN_INTENT_COOKIE = 'tl_pricing_plan_intent';
const PLAN_INTENT_TTL_SECONDS = 60 * 60 * 24 * 7;

function planIntentCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: PLAN_INTENT_TTL_SECONDS,
  };
}

/** Persist paid pricing intent across onboarding redirects without authorizing purchase. */
export async function rememberSignupPlanIntent(
  plan: unknown,
): Promise<PaidSignupPlanId | undefined> {
  const paid = paidSignupPlan(plan);
  if (!paid) return undefined;
  (await cookies()).set(PLAN_INTENT_COOKIE, paid, planIntentCookieOptions());
  return paid;
}

export async function readSignupPlanIntent(): Promise<PaidSignupPlanId | undefined> {
  const jar = await cookies();
  return paidSignupPlan(jar.get(PLAN_INTENT_COOKIE)?.value);
}

export async function clearSignupPlanIntent(): Promise<void> {
  (await cookies()).delete(PLAN_INTENT_COOKIE);
}

/**
 * Capture `?plan=` on sign-up / Team billing into a short-lived cookie from the
 * proxy response. Skip speculative prefetches so Pricing hover/viewport fetches
 * cannot invent an upgrade reminder. RSC pages only read the cookie.
 */
export function applySignupPlanIntentFromRequest(
  request: NextRequest,
  response: NextResponse,
): void {
  if (isPrefetchRequest(request)) return;

  const path = request.nextUrl.pathname;
  const onSignUp = path === '/sign-up';
  const onTeamBilling =
    path === '/app/team' && request.nextUrl.searchParams.get('section') === 'billing';
  if (!onSignUp && !onTeamBilling) return;

  const planParam = request.nextUrl.searchParams.get('plan');
  const paid = paidSignupPlan(planParam);
  if (paid) {
    response.cookies.set(PLAN_INTENT_COOKIE, paid, planIntentCookieOptions());
    return;
  }
  // Free / missing / unknown on sign-up clears a leftover paid intent (e.g. Start free).
  if (onSignUp) {
    response.cookies.delete(PLAN_INTENT_COOKIE);
  }
}
