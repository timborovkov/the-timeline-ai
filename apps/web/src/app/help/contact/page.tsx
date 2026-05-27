import Link from 'next/link';

import { SupportForm } from '@/components/support-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ContactPage() {
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY ?? undefined;
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Contact support</CardTitle>
          <CardDescription>
            Send a note to the Timeline team. We will reply by email.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SupportForm turnstileSiteKey={turnstileSiteKey} />
          <p className="text-sm text-muted-foreground">
            Prefer the overview?{' '}
            <Link href="/" className="text-primary hover:underline">
              Back to home
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
