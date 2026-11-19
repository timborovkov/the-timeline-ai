import { safeSameOriginPath } from '@/lib/safe-redirect';

const APP_FALLBACK = '/app';
const AUTH_PATHS = ['/sign-in', '/sign-up'];

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
  if (callbackPath.startsWith('/accept-invite/')) return callbackPath;
  if (input.pendingInviteToken) return inviteRedirectPath(input.pendingInviteToken);
  return callbackPath;
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
  return plan === 'payg' || plan === 'team' || plan === 'business'
    ? `/app/team?section=billing&plan=${plan}#change-plan`
    : undefined;
}

/** Only carry the fixed pricing destination, never an arbitrary email-link redirect. */
export function selectedPlanFromCallback(callback: unknown): string | undefined {
  if (typeof callback !== 'string') return undefined;
  const path = safeSameOriginPath(callback, APP_FALLBACK, { blockedPaths: AUTH_PATHS });
  const url = new URL(path, 'https://intent.invalid');
  if (url.pathname !== '/app/team' || url.searchParams.get('section') !== 'billing')
    return undefined;
  const plan = url.searchParams.get('plan');
  return plan === 'payg' || plan === 'team' || plan === 'business' ? plan : undefined;
}

/** Preserve explicit continuation before pricing, while rejecting auth loops. */
export function signupCallback(callbackUrl?: string, plan?: string): string | undefined {
  const safe = safeSameOriginPath(callbackUrl, '', { blockedPaths: AUTH_PATHS });
  return safe || selectedPlanCallback(plan);
}
