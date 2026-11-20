'use client';

import type { ReactNode } from 'react';

import styles from '@/components/public-session-branch.module.css';
import { usePublicSession } from '@/lib/public-session';

export function PublicSessionBranch({
  signedOut,
  signedIn,
}: {
  signedOut: ReactNode;
  signedIn: ReactNode;
}) {
  const session = usePublicSession();
  // Guest CTAs stay active while the session is unknown so SSR HTML and
  // no-JS browsers keep usable Start free / Sign in links. Signed-in visitors
  // who click before the session resolves are redirected by /sign-in and
  // /sign-up. Both branches share one grid cell so the optional signed-in
  // swap does not shift layout.
  const showGuest = session.status !== 'signed-in';
  const showMember = session.status === 'signed-in';
  return (
    <span className={styles.slot} data-public-session={session.status}>
      <span
        className={styles.branch}
        data-active={showGuest}
        aria-hidden={!showGuest}
        inert={!showGuest}
      >
        {signedOut}
      </span>
      <span
        className={styles.branch}
        data-active={showMember}
        aria-hidden={!showMember}
        inert={!showMember}
      >
        {signedIn}
      </span>
    </span>
  );
}
