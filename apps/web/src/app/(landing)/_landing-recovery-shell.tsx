import Link from 'next/link';

import type { ReactNode } from 'react';

import { LandingSkipLink } from '@/app/(landing)/_landing-skip-link';
import styles from '@/app/(landing)/home.module.css';
import { Logo } from '@/components/brand/logo';
import { PublicHeader } from '@/components/public-header';

const CONTACT_HREF = '/help/support';

export function LandingRecoveryShell({ children }: { children: ReactNode }) {
  const year = new Date().getFullYear();

  return (
    <div className={styles.page}>
      <div className={styles.skipLayer}>
        <LandingSkipLink />
      </div>
      <PublicHeader currentSection="product" showAccountActions={false} />
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className={styles.footer}>
        <div>
          <span className={styles.footerBrand}>
            <Logo ariaHidden /> The Timeline
          </span>
          <span>© {year}</span>
        </div>
        <nav aria-label="Landing footer">
          <Link href="/help">Help</Link>
          <Link href="/trust">Trust</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/cookies">Cookies</Link>
          <Link href={CONTACT_HREF}>Contact</Link>
        </nav>
      </footer>
    </div>
  );
}
