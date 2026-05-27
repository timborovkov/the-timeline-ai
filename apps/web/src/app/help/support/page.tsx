import type { Metadata } from 'next';

import { SupportForm } from '@/components/help/support-form';
import { auth } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Support',
  description: 'Contact The Timeline support.',
  alternates: { canonical: '/help/support' },
};

export default async function SupportPage() {
  const session = await auth();
  const requiresTurnstile = process.env.NODE_ENV === 'production';

  return (
    <article className="space-y-10">
      <header className="max-w-3xl space-y-4">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-fg-dim">Support</p>
        <h1 className="text-4xl font-semibold tracking-normal text-fg sm:text-5xl">
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
