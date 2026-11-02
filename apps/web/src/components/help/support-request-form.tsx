'use client';

import { useSearchParams } from 'next/navigation';

import { SupportForm } from '@/components/help/support-form';
import { usePublicSession } from '@/lib/public-session';
import { parseErrorReference, parseSupportSurface } from '@/lib/support-context';

export function SupportRequestForm({
  turnstileSiteKey,
  requiresTurnstile,
}: {
  turnstileSiteKey?: string;
  requiresTurnstile: boolean;
}) {
  const searchParams = useSearchParams();
  const session = usePublicSession();
  const defaultSurface = parseSupportSurface(searchParams.get('surface')) ?? undefined;
  const defaultErrorReference = defaultSurface
    ? (parseErrorReference(searchParams.get('error')) ?? undefined)
    : undefined;
  const signedIn = session.status === 'signed-in';

  return (
    <SupportForm
      key={session.status}
      defaultName={signedIn ? (session.name ?? undefined) : undefined}
      defaultEmail={signedIn ? (session.email ?? undefined) : undefined}
      defaultSurface={defaultSurface}
      defaultErrorReference={defaultErrorReference}
      turnstileSiteKey={turnstileSiteKey}
      requiresTurnstile={requiresTurnstile}
    />
  );
}
