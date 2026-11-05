import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { SignInForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';
import { OAuthSignInButtons } from '@/components/oauth-buttons';
import { auth, hasGitHubAuth, hasGoogleAuth } from '@/lib/auth';
import { signedInAuthRedirect } from '@/lib/auth-redirect';
import { oauthSignInErrorMessage } from '@/lib/oauth-sign-in';
import { readPendingInvite } from '@/lib/pending-invite';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your workspace on The Timeline.',
  robots: { index: false, follow: false },
};

interface Props {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}

export default async function SignInPage({ searchParams }: Props) {
  const [{ callbackUrl, error }, session] = await Promise.all([searchParams, auth()]);
  if (session?.user) {
    const pendingInviteToken = await readPendingInvite();
    // react-doctor-disable-next-line react-doctor/clickjacking-redirect-risk -- signedInAuthRedirect allowlists same-origin paths through safeSameOriginPath and blocks auth-loop paths.
    redirect(signedInAuthRedirect({ callbackUrl, pendingInviteToken }));
  }

  const oauthError = oauthSignInErrorMessage(error);

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your team’s timeline."
      secondaryPrefix="No account yet?"
      secondaryHref="/sign-up"
      secondaryLabel="Create one"
    >
      {oauthError ? (
        <p role="alert" className="text-sm text-destructive">
          {oauthError}
        </p>
      ) : null}
      <OAuthSignInButtons callbackUrl={callbackUrl} google={hasGoogleAuth} github={hasGitHubAuth} />
      <SignInForm callbackUrl={callbackUrl} />
    </AuthShell>
  );
}
