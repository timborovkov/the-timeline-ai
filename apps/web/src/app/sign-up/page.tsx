import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { SignUpForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';
import { GitHubSignInButton } from '@/components/github-button';
import { Separator } from '@/components/ui/separator';
import { auth, hasGitHubAuth } from '@/lib/auth';
import { signedInAuthRedirect } from '@/lib/auth-redirect';
import { readPendingInvite } from '@/lib/pending-invite';

export const metadata: Metadata = {
  title: 'Sign up',
  description: 'Create a Timeline AI account.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ invite?: string }>;
}

export default async function SignUpPage({ searchParams }: Props) {
  const [{ invite }, session] = await Promise.all([searchParams, auth()]);
  if (session?.user) {
    const pendingInviteToken = await readPendingInvite();
    redirect(signedInAuthRedirect({ inviteToken: invite, pendingInviteToken }));
  }

  const requiresTurnstile = process.env.NODE_ENV === 'production';
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY ?? undefined;
  return (
    <AuthShell
      title="Create your account"
      subtitle={
        invite
          ? 'You’ve been invited to a team. Sign up to accept.'
          : 'We’ll create your first team automatically.'
      }
      secondaryPrefix="Already have an account?"
      secondaryHref={
        invite
          ? `/sign-in?callbackUrl=${encodeURIComponent(`/accept-invite/${invite}`)}`
          : '/sign-in'
      }
      secondaryLabel="Sign in"
    >
      {hasGitHubAuth ? (
        <>
          {invite ? (
            <GitHubSignInButton callbackUrl={`/accept-invite/${invite}`} inviteToken={invite} />
          ) : (
            <GitHubSignInButton />
          )}
          {invite ? (
            <p className="text-xs text-muted-foreground">
              After GitHub sign-in we&rsquo;ll send you to the invite; accept it from there using
              the same email the invite was sent to.
            </p>
          ) : null}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" />
            <span>or</span>
            <Separator className="flex-1" />
          </div>
        </>
      ) : null}
      <SignUpForm
        inviteToken={invite}
        requiresTurnstile={requiresTurnstile}
        turnstileSiteKey={turnstileSiteKey}
      />
    </AuthShell>
  );
}
