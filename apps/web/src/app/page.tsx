import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <div className="space-y-6">
        <h1 className="text-4xl font-semibold tracking-tight">The Timeline</h1>
        <p className="max-w-prose text-lg text-muted-foreground">
          Team memory, captured. Voice notes, written notes, forwarded emails — one searchable
          history.
        </p>
        <div className="flex gap-3 pt-2">
          <Button asChild>
            <Link href="/sign-up">Get started</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
