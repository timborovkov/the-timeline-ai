import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <div className="space-y-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal">
          THE TIMELINE · OPERATIONAL ARCHIVE
        </p>
        <h1 className="text-5xl font-bold tracking-tight">
          The operations log
          <br />
          your team can <span className="text-signal">talk to</span>.
        </h1>
        <p className="max-w-prose text-lg leading-relaxed text-fg-muted">
          Voice notes, written notes, forwarded emails, Telegram messages — one searchable, cited
          history. Every answer the agent gives points back to the raw event it came from.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Button asChild>
            <Link href="/sign-up">Get started</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
        <p className="pt-8 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
          INDEXED · CITED · NEVER FORGOTTEN
        </p>
      </div>
    </main>
  );
}
