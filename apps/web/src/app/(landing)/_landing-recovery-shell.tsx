import Link from 'next/link';

import type { ReactNode } from 'react';

import { LandingSkipLink } from '@/app/(landing)/_landing-skip-link';
import styles from '@/app/(landing)/home.module.css';
import { Logo, Wordmark } from '@/components/brand/logo';
import { GitHubSourceLink } from '@/components/github-source-link';
import { ThemeToggle } from '@/components/theme-toggle';

const CONTACT_HREF = '/help/support';

export function LandingRecoveryShell({ children }: { children: ReactNode }) {
  const year = new Date().getFullYear();

  return (
    <div className={styles.page}>
      <div className={styles.skipLayer}>
        <LandingSkipLink />
      </div>
      <header className={styles.masthead}>
        <Link href="/" aria-label="The Timeline home" className={styles.brandLink}>
          <Wordmark compact />
        </Link>
        <div className={styles.mastStatus} aria-hidden="true">
          <span /> Every answer cited
        </div>
        <nav className={styles.nav} aria-label="Landing navigation">
          <GitHubSourceLink compact className={styles.githubLink} />
          <Link href="/help" className={styles.navLink}>
            Help
          </Link>
          <Link href={CONTACT_HREF} className={styles.navLink}>
            Contact
          </Link>
          <ThemeToggle className={styles.themeToggle} />
        </nav>
      </header>
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
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href={CONTACT_HREF}>Contact</Link>
        </nav>
      </footer>
    </div>
  );
}
