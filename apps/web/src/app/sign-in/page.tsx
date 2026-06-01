import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { SignInForm } from '@/components/auth-form';
import { GitHubSignInButton } from '@/components/github-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { auth, hasGitHubAuth } from '@/lib/auth';
import { safeSameOriginPath } from '@/lib/safe-redirect';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your Timeline AI workspace.',
};

interface Props {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function SignInPage({ searchParams }: Props) {
  const { callbackUrl } = await searchParams;
  const session = await auth();
  if (session?.user) redirect(safeSignedInRedirect(callbackUrl));

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Welcome back</CardTitle>
          <CardDescription>Sign in to your team's timeline.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
          <p className="text-sm text-muted-foreground">
            No account yet?{' '}
            <Link href="/sign-up" className="text-primary hover:underline">
              Create one
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

function safeSignedInRedirect(callbackUrl: string | undefined) {
  return safeSameOriginPath(callbackUrl, '/app', { blockedPaths: ['/sign-in', '/sign-up'] });
}
