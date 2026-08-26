import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import type { Metadata } from 'next';

import { HelpGuideDirectory } from '@/components/help/help-guide-directory';
import { publicMetadata } from '@/lib/public-metadata';
import {
  GITHUB_BUG_REPORT_URL,
  GITHUB_CONTRIBUTING_URL,
  GITHUB_SECURITY_URL,
  PUBLIC_SUPPORT_EMAIL,
} from '@/lib/support-links';

const supportLinkClass =
  'rounded-sm text-fg transition-colors hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

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
          <h2 className="text-base font-semibold text-fg">Security and data privacy</h2>
          <p className="mt-1 max-w-[62ch] text-sm leading-6 text-fg-muted">
            Review AI training and retention, infrastructure, permissions, meeting media, analytics,
            human access, processors, and current assurance status.
          </p>
        </div>
        <Link
          href="/trust"
          className="group inline-flex min-h-10 items-center gap-2 rounded-sm text-sm font-semibold text-fg transition-colors hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-bg forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2"
        >
          Read the Trust page
          <ArrowRight
            aria-hidden="true"
            className="size-4 transition-transform group-hover:translate-x-1"
          />
        </Link>
      </section>

      <section className="border-y border-border py-7">
        <div>
          <h2 className="text-base font-semibold text-fg">Get help or contribute</h2>
          <p className="mt-1 max-w-[62ch] text-sm leading-6 text-fg-muted">
            Send account details privately. Use GitHub only for non-sensitive, reproducible bugs and
            proposed contributions.
          </p>
        </div>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
          <Link className={supportLinkClass} href="/help/support">
            Contact support
          </Link>
          <a className={supportLinkClass} href={`mailto:${PUBLIC_SUPPORT_EMAIL}`}>
            Email {PUBLIC_SUPPORT_EMAIL}
          </a>
          <a
            className={supportLinkClass}
            href={GITHUB_BUG_REPORT_URL}
            target="_blank"
            rel="noreferrer"
          >
            Report a bug
          </a>
          <a
            className={supportLinkClass}
            href={GITHUB_SECURITY_URL}
            target="_blank"
            rel="noreferrer"
          >
            Security
          </a>
          <a
            className={supportLinkClass}
            href={GITHUB_CONTRIBUTING_URL}
            target="_blank"
            rel="noreferrer"
          >
            Contribute
          </a>
        </div>
      </section>
    </article>
  );
}
