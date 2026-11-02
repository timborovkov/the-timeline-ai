'use client';

import type { ReactNode } from 'react';

import { usePublicSession } from '@/lib/public-session';

export function PublicSessionBranch({
  signedOut,
  signedIn,
}: {
  signedOut: ReactNode;
  signedIn: ReactNode;
}) {
  const session = usePublicSession();
  const pending = session.status === 'unknown';
  const content = session.status === 'signed-in' ? signedIn : signedOut;
  if (content === null || content === undefined) return null;

  return (
    <span
      className={pending ? 'contents invisible' : 'contents'}
      data-public-session={session.status}
      {...(pending ? { 'aria-hidden': true as const, inert: true } : {})}
    >
      {content}
    </span>
  );
}
