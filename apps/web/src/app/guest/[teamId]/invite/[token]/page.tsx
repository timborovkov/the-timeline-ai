import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';

import { acceptGuest } from '@/app/actions/guests';
import { AuthShell } from '@/components/auth-shell';
import { AcceptGuestForm } from '@/components/guest-forms';
import { SignOutButton } from '@/components/sign-out-button';
import { Button } from '@/components/ui/button';
import { getRequestIdentity } from '@/lib/auth';
import { hasCurrentLegalSession } from '@/lib/auth.config';
import { isLegalPublicationReady } from '@/lib/legal-publication';
import { sensitiveLinkReferrerPolicy } from '@/lib/sensitive-links';

export const metadata: Metadata = {
  title: 'Guest invitation',
  robots: { index: false, follow: false },
  referrer: sensitiveLinkReferrerPolicy,
};

export default async function GuestInvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string; token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ teamId, token }, { error }, { session, impersonation }] = await Promise.all([
    params,
    searchParams,
    getRequestIdentity(),
  ]);
  if (!z.uuid().safeParse(teamId).success || !/^[A-Za-z0-9_-]{43}$/.test(token) || impersonation)
    notFound();
  const invite = `/guest/${teamId}/invite/${token}`;
  if (session?.user && isLegalPublicationReady() && !hasCurrentLegalSession(session.user)) {
    redirect(`/legal/accept?returnTo=${encodeURIComponent(invite)}`);
  }
  return (
    <AuthShell
      title="Guest invitation"
      subtitle="Guests can open and ask questions about work shared directly with them."
    >
      {session?.user ? (
        <>
          {error ? (
            <p role="alert">
              Verify that you are signed in with the invited email address, then reopen this
              invitation. If the link has expired, ask for a fresh one.
            </p>
          ) : null}
          <AcceptGuestForm action={acceptGuest.bind(null, teamId, token)} />
          <SignOutButton label="Switch account" callbackUrl={invite} />
        </>
      ) : (
        <div className="flex gap-3">
          <Button asChild>
            <Link href={`/sign-in?callbackUrl=${encodeURIComponent(invite)}`}>Sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/sign-up?callbackUrl=${encodeURIComponent(invite)}`}>Sign up</Link>
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
