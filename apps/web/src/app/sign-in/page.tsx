import Link from 'next/link';

import { SignInForm } from '@/components/auth-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function SignInPage({ searchParams }: Props) {
  const { callbackUrl } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Welcome back</CardTitle>
          <CardDescription>Sign in to your team's timeline.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
