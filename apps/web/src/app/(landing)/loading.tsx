import Link from 'next/link';

import { LandingSkipLink } from '@/app/(landing)/_landing-skip-link';
import styles from '@/app/(landing)/home.module.css';
import { Logo } from '@/components/brand/logo';
import { CookieSettingsButton } from '@/components/public-analytics';
import { PublicHeader } from '@/components/public-header';
import { PublicNavigationItems } from '@/components/public-navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const CONTACT_HREF = '/help/support';

export default function LandingLoading() {
  const year = new Date().getFullYear();

  return (
    <div className={styles.page}>
      <div className={styles.skipLayer}>
        <LandingSkipLink />
      </div>
      <div className={styles.progress} aria-hidden="true">
        <span />
      </div>
      <PublicHeader currentSection="product" showAccountActions={false} />
      <main id="main" tabIndex={-1}>
        <output className="sr-only" aria-live="polite">
          Loading The Timeline
        </output>
        <section
          aria-busy="true"
          aria-label="The Timeline loading placeholder"
          className={cn(styles.scene, styles.claimScene)}
        >
          <div className={styles.heroCopy}>
            <div className={styles.sceneIndex}>
              <span>01</span>
              <span>AI team memory</span>
            </div>
            <h1 id="claim-title" className={styles.heroTitle}>
              Scattered work. <em>Cited answers.</em>
            </h1>
            <p className={styles.heroIntro}>
              Timeline is AI team memory for real projects. It preserves the messages, meetings,
              documents, tickets, and code you choose in one chronological record. Ask what
              happened, what changed, and what comes next—then trace each claim back to the source.
            </p>
            <div className={styles.heroActions} aria-hidden="true">
              <Skeleton className="h-12 w-48 rounded-sm motion-reduce:animate-none" />
              <Skeleton className="h-6 w-44 motion-reduce:animate-none" />
            </div>
          </div>
          <div className={styles.observatory} aria-hidden="true">
            <Skeleton className="size-full rounded-none motion-reduce:animate-none" />
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <div>
          <span className={styles.footerBrand}>
            <Logo ariaHidden /> The Timeline
          </span>
          <span>© {year}</span>
        </div>
        <div className={styles.footerNavigation}>
          <nav aria-label="Explore The Timeline">
            <PublicNavigationItems
              currentSection="product"
              listClassName={styles.footerLinks}
              activeItemClassName={styles.footerLinkActive}
            />
          </nav>
          <nav aria-label="Support and legal">
            <Link href="/help">Help</Link>
            <Link href="/trust">Trust</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/cookies">Cookies</Link>
            <CookieSettingsButton />
            <Link href={CONTACT_HREF}>Contact</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
