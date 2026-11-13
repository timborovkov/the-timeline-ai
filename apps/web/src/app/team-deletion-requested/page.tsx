import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { getSupportEmail } from '@/lib/support-email';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Deletion requested',
  robots: { index: false, follow: false },
};

export default async function TeamDeletionRequestedPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  const supportEmail = getSupportEmail();
  const contactHref = `mailto:${supportEmail}?subject=${encodeURIComponent('Request to restore a team')}`;

  return (
    <main id="main-content" className="mx-auto max-w-lg space-y-6 px-6 py-16">
      <h1 className="text-xl font-semibold">Deletion requested</h1>
      <p className="text-sm">
        Your request has been submitted. The team is now disabled for every member. Platform admins
        will review the request before starting permanent deletion.
      </p>
      <section aria-labelledby="restore-heading" className="space-y-3">
        <h2 id="restore-heading" className="font-medium">
          Changed your mind?
        </h2>
        <p className="text-sm text-fg-muted">
          Contact support as soon as possible to request restoration. Only platform admins can
          restore access, and only before permanent deletion begins. Once deletion starts, it cannot
          be reversed.
        </p>
        <a
          href={contactHref}
          className="inline-flex min-h-11 items-center text-sm underline break-all"
        >
          {supportEmail}
        </a>
        <p className="text-sm text-fg-muted">
          Include the team name and the email address you use to sign in.
        </p>
      </section>
      <p className="text-sm text-fg-muted">Your account and other teams are preserved.</p>
      <Link
        href={active ? '/app' : '/'}
        className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 text-sm"
      >
        {active ? 'Continue to another team' : 'Back to home'}
      </Link>
    </main>
  );
}
