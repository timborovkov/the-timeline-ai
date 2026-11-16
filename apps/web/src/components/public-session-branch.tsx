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
  // Both branches size the same grid cell from the server render onward. The
  // inactive branch remains inert and invisible, including when one is null.
  return (
    <span className={styles.slot} data-public-session={session.status}>
      <span
        className={styles.branch}
        data-active={session.status === 'signed-out'}
        aria-hidden={session.status !== 'signed-out'}
        inert={session.status !== 'signed-out'}
      >
        {signedOut}
      </span>
      <span
        className={styles.branch}
        data-active={session.status === 'signed-in'}
        aria-hidden={session.status !== 'signed-in'}
        inert={session.status !== 'signed-in'}
      >
        {signedIn}
      </span>
    </span>
  );
}
