import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { SignUpForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';
import { OAuthSignInButtons } from '@/components/oauth-buttons';
import { SignupPlanSummary } from '@/components/signup-plan-summary';
import { auth, hasGitHubAuth, hasGoogleAuth } from '@/lib/auth';
import { signedInAuthRedirect, signupCallback } from '@/lib/auth-redirect';
import { readLastLoginMethod } from '@/lib/last-login-method';
import { isLegalPublicationReady } from '@/lib/legal-publication';
import { readPendingInvite } from '@/lib/pending-invite';
import { parseSignupPlan, signupPlanCopy } from '@/lib/signup-plan';

export const metadata: Metadata = {
  title: 'Sign up',
  description: 'Start free with The Timeline.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ invite?: string; plan?: string; callbackUrl?: string }>;
}

export default async function SignUpPage({ searchParams }: Props) {
  const [{ invite, plan, callbackUrl: requestedCallback }, session] = await Promise.all([
    searchParams,
    auth(),
  ]);
  const selectedPlan = parseSignupPlan(plan);
  const callbackUrl = signupCallback(requestedCallback, selectedPlan);
  if (session?.user) {
    const pendingInviteToken = await readPendingInvite();
    // react-doctor-disable-next-line react-doctor/clickjacking-redirect-risk -- signedInAuthRedirect validates same-origin paths and selectedPlanCallback only returns fixed billing destinations; malicious input is covered by auth-redirect tests.
    redirect(signedInAuthRedirect({ inviteToken: invite, pendingInviteToken, callbackUrl }));
  }

  const requiresTurnstile = process.env.NODE_ENV === 'production';
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY ?? undefined;
  const legalPublicationReady = isLegalPublicationReady();
  const lastLoginMethod = await readLastLoginMethod();
  const planCopy = signupPlanCopy(selectedPlan);
  return (
    <AuthShell
      title="Create your account"
      subtitle={signupSubtitle({
        invited: Boolean(invite),
        ready: legalPublicationReady,
        planSubtitle: planCopy.subtitle,
      })}
      secondaryPrefix="Already have an account?"
      secondaryHref={
        invite
          ? `/sign-in?callbackUrl=${encodeURIComponent(`/accept-invite/${invite}`)}`
          : callbackUrl
            ? `/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`
            : '/sign-in'
      }
      secondaryLabel="Sign in"
    >
      {!invite && legalPublicationReady ? <SignupPlanSummary copy={planCopy} /> : null}
      {legalPublicationReady ? (
        <OAuthSignInButtons
          lastLoginMethod={lastLoginMethod}
          callbackUrl={invite ? `/accept-invite/${invite}` : callbackUrl}
          inviteToken={invite}
          google={hasGoogleAuth}
          github={hasGitHubAuth}
        />
      ) : null}
      <SignUpForm
        lastUsed={lastLoginMethod === 'credentials'}
        callbackUrl={callbackUrl}
        inviteToken={invite}
        legalPublicationReady={legalPublicationReady}
        requiresTurnstile={requiresTurnstile}
        turnstileSiteKey={turnstileSiteKey}
      />
    </AuthShell>
  );
}

function signupSubtitle(input: { invited: boolean; ready: boolean; planSubtitle: string }): string {
  if (!input.ready)
    return 'New accounts are paused while our legal publication review is completed.';
  return input.invited ? 'You’ve been invited to a team. Sign up to accept.' : input.planSubtitle;
}
