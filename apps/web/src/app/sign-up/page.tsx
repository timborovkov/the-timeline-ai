import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { SignUpForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';
import { GitHubSignInButton } from '@/components/github-button';
import { Separator } from '@/components/ui/separator';
import { auth, hasGitHubAuth } from '@/lib/auth';
import { signedInAuthRedirect, selectedPlanCallback } from '@/lib/auth-redirect';
import { isLegalPublicationReady } from '@/lib/legal-publication';
import { readPendingInvite } from '@/lib/pending-invite';

export const metadata: Metadata = {
  title: 'Sign up',
  description: 'Create a Timeline AI account.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ invite?: string; plan?: string }>;
}

export default async function SignUpPage({ searchParams }: Props) {
  const [{ invite, plan }, session] = await Promise.all([searchParams, auth()]);
  const callbackUrl = selectedPlanCallback(plan);
  if (session?.user) {
    const pendingInviteToken = await readPendingInvite();
    // react-doctor-disable-next-line react-doctor/clickjacking-redirect-risk -- signedInAuthRedirect validates same-origin paths and selectedPlanCallback only returns fixed billing destinations; malicious input is covered by auth-redirect tests.
    redirect(signedInAuthRedirect({ inviteToken: invite, pendingInviteToken, callbackUrl }));
  }

  const requiresTurnstile = process.env.NODE_ENV === 'production';
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY ?? undefined;
  const legalPublicationReady = isLegalPublicationReady();
  return (
    <AuthShell
      title="Create your account"
      subtitle={signupSubtitle(Boolean(invite), legalPublicationReady)}
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
      {hasGitHubAuth && legalPublicationReady ? (
        <SignupGitHubOptions invite={invite} callbackUrl={callbackUrl} />
      ) : null}
      <SignUpForm
        callbackUrl={callbackUrl}
        inviteToken={invite}
        legalPublicationReady={legalPublicationReady}
        requiresTurnstile={requiresTurnstile}
        turnstileSiteKey={turnstileSiteKey}
      />
    </AuthShell>
  );
}

function signupSubtitle(invited: boolean, ready: boolean): string {
  if (!ready) return 'New accounts are paused while our legal publication review is completed.';
  return invited
    ? 'You’ve been invited to a team. Sign up to accept.'
    : 'Free for small teams — no card required. We’ll create your first team automatically.';
}

function SignupGitHubOptions({ invite, callbackUrl }: { invite?: string; callbackUrl?: string }) {
  return (
    <>
      <GitHubSignInButton
        callbackUrl={invite ? `/accept-invite/${invite}` : callbackUrl}
        inviteToken={invite}
      />
      {invite ? (
        <p className="text-xs text-muted-foreground">
          After GitHub sign-in we&rsquo;ll send you to the invite; accept it from there using the
          same email the invite was sent to.
        </p>
      ) : null}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Separator className="flex-1" />
        <span>or</span>
        <Separator className="flex-1" />
      </div>
    </>
  );
}
