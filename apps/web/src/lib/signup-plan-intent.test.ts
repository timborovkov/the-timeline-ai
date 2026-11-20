import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';

import { paidSignupPlan } from '@/lib/signup-plan';
import { PLAN_INTENT_COOKIE, applySignupPlanIntentFromRequest } from '@/lib/signup-plan-intent';

function request(path: string, headers?: Record<string, string>): NextRequest {
  return new NextRequest(new URL(path, 'https://timeline.test'), {
    headers,
  });
}

describe('applySignupPlanIntentFromRequest', () => {
  it('stores paid plan intent from sign-up and team billing URLs', () => {
    const response = NextResponse.next();
    applySignupPlanIntentFromRequest(request('/sign-up?plan=team'), response);
    expect(response.cookies.get(PLAN_INTENT_COOKIE)?.value).toBe('team');

    const billing = NextResponse.next();
    applySignupPlanIntentFromRequest(
      request('/app/team?section=billing&plan=business#change-plan'),
      billing,
    );
    expect(billing.cookies.get(PLAN_INTENT_COOKIE)?.value).toBe('business');
  });

  it('clears intent on free/missing/unknown sign-up plans and ignores unrelated routes', () => {
    const cleared = NextResponse.next();
    cleared.cookies.set(PLAN_INTENT_COOKIE, 'team');
    applySignupPlanIntentFromRequest(request('/sign-up?plan=enterprise'), cleared);
    expect(paidSignupPlan(cleared.cookies.get(PLAN_INTENT_COOKIE)?.value)).toBeUndefined();

    const startFree = NextResponse.next();
    startFree.cookies.set(PLAN_INTENT_COOKIE, 'team');
    applySignupPlanIntentFromRequest(request('/sign-up'), startFree);
    expect(paidSignupPlan(startFree.cookies.get(PLAN_INTENT_COOKIE)?.value)).toBeUndefined();

    const ignored = NextResponse.next();
    applySignupPlanIntentFromRequest(request('/pricing?plan=team'), ignored);
    expect(ignored.cookies.get(PLAN_INTENT_COOKIE)?.value).toBeUndefined();
  });

  it('ignores Next.js and browser prefetch requests so Pricing links cannot invent intent', () => {
    const prefetchHeaders: Record<string, string>[] = [
      { 'next-router-prefetch': '1' },
      { 'x-middleware-prefetch': '1' },
      { purpose: 'prefetch' },
      { 'sec-purpose': 'prefetch;prerender' },
    ];
    for (const headers of prefetchHeaders) {
      const response = NextResponse.next();
      applySignupPlanIntentFromRequest(request('/sign-up?plan=team', headers), response);
      expect(response.cookies.get(PLAN_INTENT_COOKIE)?.value).toBeUndefined();
    }
  });
});
