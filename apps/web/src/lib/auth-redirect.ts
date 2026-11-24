import { safeSameOriginPath } from '@/lib/safe-redirect';
import { paidSignupPlan, type PaidSignupPlanId } from '@/lib/signup-plan';

const APP_FALLBACK = '/app';
const SIGN_IN_CONTINUATION_PATH = '/sign-in/continue';
const AUTH_PATHS = ['/sign-in', '/sign-up', SIGN_IN_CONTINUATION_PATH];
const GUEST_INVITE_PATH = /^\/guest\/[0-9a-f-]{36}\/invite\/[A-Za-z0-9_-]{43}$/;

function inviteRedirectPath(token: string): string {
  return `/accept-invite/${encodeURIComponent(token)}`;
}

/** Extract an invite token from a same-origin `/accept-invite/<token>` callback. */
export function inviteTokenFromCallback(callbackUrl: string | undefined): string | undefined {
  if (!callbackUrl) return undefined;
  const callbackPath = safeSameOriginPath(callbackUrl, '', { blockedPaths: AUTH_PATHS });
  if (!callbackPath.startsWith('/accept-invite/')) return undefined;
  const raw = callbackPath.slice('/accept-invite/'.length).split(/[?#]/, 1)[0] ?? '';
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
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
  if (callbackPath.startsWith('/accept-invite/') || GUEST_INVITE_PATH.test(callbackPath))
    return callbackPath;
  if (input.pendingInviteToken) return inviteRedirectPath(input.pendingInviteToken);
  return callbackPath;
}

export function credentialSignInContinuation(callbackUrl: string): string {
  const destination = signedInAuthRedirect({ callbackUrl });
  return `${SIGN_IN_CONTINUATION_PATH}?${new URLSearchParams({ callbackUrl: destination })}`;
}

/** Prefer `?invite=` when linking to sign-up from an invite acceptance callback. */
export function signUpHrefFromAuthCallback(callbackUrl: string | undefined): string {
  if (!callbackUrl) return '/sign-up';
  const inviteToken = inviteTokenFromCallback(callbackUrl);
  if (inviteToken) return `/sign-up?invite=${encodeURIComponent(inviteToken)}`;
  const dest = signedInAuthRedirect({ callbackUrl });
  return `/sign-up?callbackUrl=${encodeURIComponent(dest)}`;
}

/** Pricing intent is navigation only; it never authorizes a purchase. */
export function selectedPlanCallback(plan: unknown): string | undefined {
  const paid = paidSignupPlan(plan);
  return paid ? `/app/team?section=billing&plan=${paid}#change-plan` : undefined;
}

/** Only carry the fixed pricing destination, never an arbitrary email-link redirect. */
export function selectedPlanFromCallback(callback: unknown): PaidSignupPlanId | undefined {
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
 * existing accounts (Sign in). Solo signups still go through /onboarding via
 * `postSignupDestination` (Welcome mints the team) — not here.
 */
export function signupCallback(callbackUrl?: string, plan?: string): string | undefined {
  const safe = safeSameOriginPath(callbackUrl, '', { blockedPaths: AUTH_PATHS });
  if (safe) return safe;
  return selectedPlanCallback(plan);
}

/**
 * Where to send the user after credentials sign-up succeeds.
 * Solo accounts always finish workspace creation on Welcome (/onboarding) before
 * any other destination — including pricing plan intent (cookie only). Invite
 * joiners go straight into the invited team. MCP authorize parking for teamless
 * users lives on /oauth/authorize, not here.
 */
export function postSignupDestination(input: {
  inviteToken?: string;
  event: 'account_created' | 'invite_accepted';
  callbackUrl: string;
}): string {
  if (input.inviteToken || input.event === 'invite_accepted') return '/app';
  const guestInvite = safeSameOriginPath(input.callbackUrl, '', { blockedPaths: AUTH_PATHS });
  if (GUEST_INVITE_PATH.test(guestInvite)) return guestInvite;
  // callbackUrl is intentionally ignored for solo account_created — Welcome
  // always runs first; plan intent stays in the cookie, MCP parking elsewhere.
  return '/onboarding';
}
