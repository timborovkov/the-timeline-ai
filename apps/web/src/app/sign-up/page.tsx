import Link from 'next/link';

import { SignUpForm } from '@/components/auth-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

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
