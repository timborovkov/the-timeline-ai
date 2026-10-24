import Link from 'next/link';

import { Wordmark } from '@/components/brand/logo';
import { GitHubSourceLink } from '@/components/github-source-link';
import styles from '@/components/public-header.module.css';
import {
  PublicNavigationDisclosure,
  PublicNavigationItems,
  type PublicNavigationSection,
} from '@/components/public-navigation';
import publicSiteStyles from '@/components/public-site.module.css';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

export function PublicHeader({
  isSignedIn = false,
  currentSection,
  showAccountActions = true,
}: {
  isSignedIn?: boolean;
  currentSection?: PublicNavigationSection;
  showAccountActions?: boolean;
}) {
  return (
    <header className={cn(publicSiteStyles.chrome, styles.header)} data-public-header>
      <Link href="/" aria-label="The Timeline home" className={styles.brandLink}>
        <Wordmark compact />
      </Link>
      <nav aria-label="Public navigation" className={styles.desktopNav}>
        <PublicNavigationItems
          currentSection={currentSection}
          listClassName={styles.navList}
          itemClassName={styles.navLink}
          activeItemClassName={styles.navLinkActive}
        />
      </nav>
      <div className={styles.actions}>
        <PublicNavigationDisclosure
          currentSection={currentSection}
          className={styles.publicMenu}
          isSignedIn={isSignedIn}
          showAccountActions={showAccountActions}
        />
        <GitHubSourceLink compact className={styles.githubLink} />
        {showAccountActions && !isSignedIn ? (
          <Link href="/sign-in" className={cn(styles.navLink, styles.signInLink)}>
            Sign in
          </Link>
        ) : null}
        <ThemeToggle className={styles.themeToggle} />
        {showAccountActions ? (
          <Link
            href={isSignedIn ? '/app' : '/sign-up'}
            className={styles.navCta}
            title={isSignedIn ? undefined : 'Free to start — no card required'}
          >
            {isSignedIn ? 'Dashboard' : 'Start free'}
          </Link>
        ) : null}
      </div>
    </header>
  );
}
