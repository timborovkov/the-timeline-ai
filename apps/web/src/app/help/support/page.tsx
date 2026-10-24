import {
  ArrowLeft,
  Bug,
  ExternalLink,
  GitPullRequest,
  Mail,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import type { Metadata } from 'next';

import { SupportForm } from '@/components/help/support-form';
import { auth } from '@/lib/auth';
import { publicMetadata } from '@/lib/public-metadata';
import { parseErrorReference, parseSupportSurface } from '@/lib/support-context';
import {
  GITHUB_BUG_REPORT_URL,
  GITHUB_CONTRIBUTING_URL,
  GITHUB_SECURITY_URL,
  PUBLIC_SUPPORT_EMAIL,
} from '@/lib/support-links';

export const metadata: Metadata = publicMetadata({
  title: 'Help and support',
  description: 'Contact Timeline privately, report a bug, disclose a vulnerability, or contribute.',
  path: '/help/support',
});

interface SupportPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SupportPage({ searchParams }: SupportPageProps) {
  const [query, session] = await Promise.all([searchParams, auth()]);
  const requiresTurnstile = process.env.NODE_ENV === 'production';
  const defaultSurface = parseSupportSurface(firstParam(query.surface)) ?? undefined;
  const defaultErrorReference = defaultSurface
    ? (parseErrorReference(firstParam(query.error)) ?? undefined)
    : undefined;

  return (
    <article className="space-y-12">
      <header className="max-w-3xl space-y-4">
        <Link
          href="/help"
          className="inline-flex min-h-10 items-center gap-2 rounded-sm text-sm font-medium text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          All guides
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          Choose the right support channel.
        </h1>
        <p className="text-lg text-fg-muted">
          Keep account details and sensitive reports private. Use GitHub for reproducible,
          non-sensitive bugs and proposed contributions.
        </p>
      </header>

      <section
        aria-label="Support channels"
        className="grid gap-px border border-border bg-border sm:grid-cols-2"
      >
        <SupportChannel
          icon={Mail}
          title="Private support"
          body="Send account-specific questions, sensitive bugs, sales requests, or billing questions privately."
          href={`mailto:${PUBLIC_SUPPORT_EMAIL}`}
          label={`Email ${PUBLIC_SUPPORT_EMAIL}`}
        />
        <SupportChannel
          icon={Bug}
          title="Report a bug"
          body="Open a public issue only when you can reproduce the problem without customer data, personal data, or secrets."
          href={GITHUB_BUG_REPORT_URL}
          label="Open the bug report form"
          external
        />
        <SupportChannel
          icon={ShieldCheck}
          title="Report a vulnerability"
          body="Follow the private security-reporting process. Never disclose an unpatched vulnerability in a public issue."
          href={GITHUB_SECURITY_URL}
          label="Read the security policy"
          external
        />
        <SupportChannel
          icon={GitPullRequest}
          title="Contribute"
          body="Start with an issue and wait for maintainer agreement before substantial work or a pull request."
          href={GITHUB_CONTRIBUTING_URL}
          label="Read the contribution guide"
          external
        />
      </section>

      <section
        aria-labelledby="private-support-title"
        className="max-w-2xl border-t border-border pt-8"
      >
        <div className="mb-7 space-y-2">
          <h2 id="private-support-title" className="text-2xl font-semibold text-fg">
            Send a private request
          </h2>
          <p className="text-sm leading-6 text-fg-muted">
            Requests are stored for support handling and emailed to the Timeline team. You can also
            email{' '}
            <a
              className="rounded-sm text-fg underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              href={`mailto:${PUBLIC_SUPPORT_EMAIL}`}
            >
              {PUBLIC_SUPPORT_EMAIL}
            </a>
            .
          </p>
        </div>
        <SupportForm
          defaultName={session ? (session.user.name ?? undefined) : undefined}
          defaultEmail={session ? (session.user.email ?? undefined) : undefined}
          defaultSurface={defaultSurface}
          defaultErrorReference={defaultErrorReference}
          turnstileSiteKey={process.env.TURNSTILE_SITE_KEY}
          requiresTurnstile={requiresTurnstile}
        />
      </section>
    </article>
  );
}

function SupportChannel({
  icon: Icon,
  title,
  body,
  href,
  label,
  external = false,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  href: string;
  label: string;
  external?: boolean;
}) {
  return (
    <div className="flex flex-col bg-bg p-5 sm:p-6">
      <Icon aria-hidden="true" className="size-5 text-signal" />
      <h2 className="mt-4 text-base font-semibold text-fg">{title}</h2>
      <p className="mt-2 flex-1 text-sm leading-6 text-fg-muted">{body}</p>
      <a
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noreferrer' : undefined}
        className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-sm text-sm font-semibold text-fg transition-colors hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {label}
        {external ? <ExternalLink aria-hidden="true" className="size-3.5" /> : null}
      </a>
    </div>
  );
}
