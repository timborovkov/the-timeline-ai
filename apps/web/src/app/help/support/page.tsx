import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import type { Metadata } from 'next';

import { SupportForm } from '@/components/help/support-form';
import { auth } from '@/lib/auth';
import { publicMetadata } from '@/lib/public-metadata';

export const metadata: Metadata = publicMetadata({
  title: 'Support',
  description: 'Contact The Timeline support.',
  path: '/help/support',
});

export default async function SupportPage() {
  const session = await auth();
  const requiresTurnstile = process.env.NODE_ENV === 'production';

  return (
    <article className="space-y-10">
      <header className="max-w-3xl space-y-4">
        <Link
          href="/help"
          className="inline-flex min-h-10 items-center gap-2 rounded-sm text-sm font-medium text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          All guides
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          Tell us what broke, what you need, or what you want to buy.
        </h1>
        <p className="text-lg text-fg-muted">
          Requests are emailed to support and stored for internal inspection. Signed-in users
          include team context automatically.
        </p>
      </header>

      <section className="max-w-2xl border-t border-border pt-8">
        <SupportForm
          defaultName={session ? (session.user.name ?? undefined) : undefined}
          defaultEmail={session ? (session.user.email ?? undefined) : undefined}
          turnstileSiteKey={process.env.TURNSTILE_SITE_KEY}
          requiresTurnstile={requiresTurnstile}
        />
      </section>
    </article>
  );
}
