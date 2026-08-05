import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import type { Metadata } from 'next';

import { HelpGuideDirectory } from '@/components/help/help-guide-directory';
import { publicMetadata } from '@/lib/public-metadata';

export const metadata: Metadata = publicMetadata({
  title: 'Help',
  description: 'Public help docs for The Timeline.',
  path: '/help',
});

export default function HelpIndexPage() {
  return (
    <article className="space-y-12">
      <header className="max-w-[70ch] space-y-4">
        <p className="font-mono text-xs tracking-wide text-fg-dim">HELP / PUBLIC GUIDES</p>
        <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          Find the guide for the work in front of you.
        </h1>
        <p className="max-w-[62ch] text-lg leading-8 text-fg-muted">
          Learn how to capture activity, organize work, connect sources, and trace answers back to
          evidence. No account is required to read.
        </p>
      </header>

      <HelpGuideDirectory />

      <section className="grid gap-5 border-y border-border py-7 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div>
          <h2 className="text-base font-semibold text-fg">Still stuck?</h2>
          <p className="mt-1 max-w-[62ch] text-sm leading-6 text-fg-muted">
            Send the route, what you expected, and what happened. Signed-in requests include team
            context automatically.
          </p>
        </div>
        <Link
          href="/help/support"
          className="group inline-flex min-h-10 items-center gap-2 rounded-sm text-sm font-semibold text-fg transition-colors hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-bg forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2"
        >
          Contact support
          <ArrowRight
            aria-hidden="true"
            className="size-4 transition-transform group-hover:translate-x-1"
          />
        </Link>
      </section>
    </article>
  );
}
