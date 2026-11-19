import { safeSameOriginPath } from '@/lib/safe-redirect';
import { paidSignupPlan } from '@/lib/signup-plan';

const APP_FALLBACK = '/app';
const AUTH_PATHS = ['/sign-in', '/sign-up'];

function inviteRedirectPath(token: string): string {
  return `/accept-invite/${encodeURIComponent(token)}`;
}

export function signedInAuthRedirect(input: {
  callbackUrl?: string;
  inviteToken?: string;
  pendingInviteToken?: string | null;
}): string {
  if (input.inviteToken) return inviteRedirectPath(input.inviteToken);

  const callbackPath = safeSameOriginPath(input.callbackUrl, APP_FALLBACK, {
    blockedPaths: AUTH_PATHS,
  });
  if (callbackPath.startsWith('/accept-invite/')) return callbackPath;
  if (input.pendingInviteToken) return inviteRedirectPath(input.pendingInviteToken);
  return callbackPath;
}

/** Pricing intent is navigation only; it never authorizes a purchase. */
export function selectedPlanCallback(plan: unknown): string | undefined {
  const paid = paidSignupPlan(plan);
  return paid ? `/app/team?section=billing&plan=${paid}#change-plan` : undefined;
}

/** Only carry the fixed pricing destination, never an arbitrary email-link redirect. */
export function selectedPlanFromCallback(callback: unknown): string | undefined {
  if (typeof callback !== 'string') return undefined;
  const path = safeSameOriginPath(callback, APP_FALLBACK, { blockedPaths: AUTH_PATHS });
  const url = new URL(path, 'https://intent.invalid');
  if (url.pathname !== '/app/team' || url.searchParams.get('section') !== 'billing')
    return undefined;
  return paidSignupPlan(url.searchParams.get('plan'));
}

/**
 * Preserve explicit continuation before pricing, while rejecting auth loops.
 * Paid plan intent stays in `tl_pricing_plan_intent` and as a Billing callback for
 * existing accounts (Sign in). New teams still go through /onboarding via
 * `postSignupDestination` after team_created — not here.
 */
export function signupCallback(callbackUrl?: string, plan?: string): string | undefined {
  const safe = safeSameOriginPath(callbackUrl, '', { blockedPaths: AUTH_PATHS });
  if (safe) return safe;
  return selectedPlanCallback(plan);
}

/**
 * Where to send the user after credentials sign-up succeeds.
 * Explicit continuations (accept-invite, MCP /oauth/authorize) win over first-run
 * setup. Owned teams otherwise start in /onboarding; paid plan intent stays in
 * the cookie rather than skipping setup for Billing.
 */
export function postSignupDestination(input: {
  inviteToken?: string;
  event: 'team_created' | 'invite_accepted';
  callbackUrl: string;
}): string {
  if (input.inviteToken) return '/app';
  if (input.event !== 'team_created') return input.callbackUrl;
  if (
    input.callbackUrl.startsWith('/accept-invite/') ||
    input.callbackUrl.startsWith('/oauth/authorize')
  ) {
    return input.callbackUrl;
  }
  return '/onboarding';
}
