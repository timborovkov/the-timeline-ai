import Link from 'next/link';

import { SignUpForm } from '@/components/auth-form';
import { GitHubSignInButton } from '@/components/github-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { hasGitHubAuth } from '@/lib/auth';

interface Props {
  searchParams: Promise<{ invite?: string }>;
}

export default async function SignUpPage({ searchParams }: Props) {
  const { invite } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>
            {invite
              ? "You've been invited to a team. Sign up to accept."
              : "We'll create your first team automatically."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasGitHubAuth ? (
            <>
              {invite ? (
                <GitHubSignInButton
                  callbackUrl={`/accept-invite/${invite}`}
                  inviteToken={invite}
                />
              ) : (
                <GitHubSignInButton />
              )}
              {invite ? (
                <p className="text-xs text-muted-foreground">
                  After GitHub sign-in we&rsquo;ll send you to the invite — accept it from there
                  using the same email the invite was sent to.
                </p>
              ) : null}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <Separator className="flex-1" />
                <span>or</span>
                <Separator className="flex-1" />
              </div>
            </>
          ) : null}
          <SignUpForm inviteToken={invite} />
          <p className="text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link
              href={
                invite
                  ? `/sign-in?callbackUrl=${encodeURIComponent(`/accept-invite/${invite}`)}`
                  : '/sign-in'
              }
              className="text-primary hover:underline"
            >
              Sign in
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
