import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { SignInForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';
import { GitHubSignInButton } from '@/components/github-button';
import { Separator } from '@/components/ui/separator';
import { auth, hasGitHubAuth } from '@/lib/auth';
import { signedInAuthRedirect } from '@/lib/auth-redirect';
import { readPendingInvite } from '@/lib/pending-invite';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your Timeline AI workspace.',
  robots: { index: false, follow: false },
};

interface Props {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function SignInPage({ searchParams }: Props) {
  const [{ callbackUrl }, session] = await Promise.all([searchParams, auth()]);
  if (session?.user) {
    const pendingInviteToken = await readPendingInvite();
    // react-doctor-disable-next-line react-doctor/clickjacking-redirect-risk -- signedInAuthRedirect allowlists same-origin paths through safeSameOriginPath and blocks auth-loop paths.
    redirect(signedInAuthRedirect({ callbackUrl, pendingInviteToken }));
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your team’s timeline."
      secondaryPrefix="No account yet?"
      secondaryHref="/sign-up"
      secondaryLabel="Create one"
    >
      {hasGitHubAuth ? (
        <>
          <GitHubSignInButton callbackUrl={callbackUrl} />
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" />
            <span>or</span>
            <Separator className="flex-1" />
          </div>
        </>
      ) : null}
      <SignInForm callbackUrl={callbackUrl} />
    </AuthShell>
  );
}
