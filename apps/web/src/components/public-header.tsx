import Link from 'next/link';

import { Wordmark } from '@/components/brand/logo';
import { GitHubSourceLink } from '@/components/github-source-link';
import styles from '@/components/public-header.module.css';
import {
  PublicNavigationDisclosure,
  PublicNavigationItems,
  type PublicNavigationSection,
} from '@/components/public-navigation';
import { PublicSessionBranch } from '@/components/public-session-branch';
import publicSiteStyles from '@/components/public-site.module.css';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

export function PublicHeader({
  currentSection,
  showAccountActions = true,
}: {
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
          showAccountActions={showAccountActions}
        />
        <GitHubSourceLink compact className={styles.githubLink} />
        {showAccountActions ? (
          <PublicSessionBranch
            signedOut={
              <Link
                href="/sign-in"
                data-public-analytics-cta="sign_in"
                className={cn(styles.navLink, styles.signInLink)}
              >
                Sign in
              </Link>
            }
            signedIn={null}
          />
        ) : null}
        <ThemeToggle className={styles.themeToggle} />
        {showAccountActions ? (
          <PublicSessionBranch
            signedOut={
              <Link
                href="/sign-up"
                data-public-analytics-cta="try_project"
                className={styles.navCta}
                title="Free to start — no card required"
              >
                Start free
              </Link>
            }
            signedIn={
              <Link
                href="/app"
                data-public-analytics-cta="open_dashboard"
                className={styles.navCta}
              >
                Dashboard
              </Link>
            }
          />
        ) : null}
      </div>
    </header>
  );
}
