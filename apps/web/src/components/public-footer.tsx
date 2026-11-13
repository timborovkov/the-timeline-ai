import Link from 'next/link';

import { Wordmark } from '@/components/brand/logo';
import { GitHubSourceLink } from '@/components/github-source-link';
import { CookieSettingsButton } from '@/components/public-analytics';
import styles from '@/components/public-footer.module.css';
import { PublicFooterColumns, type PublicNavigationSection } from '@/components/public-navigation';
import { PublicSessionBranch } from '@/components/public-session-branch';
import publicSiteStyles from '@/components/public-site.module.css';
import { cn } from '@/lib/utils';

export function PublicFooter({
  currentSection,
  showAccountActions = true,
  widthClassName = 'max-w-6xl',
}: {
  currentSection?: PublicNavigationSection;
  showAccountActions?: boolean;
  widthClassName?: string;
}) {
  return (
    <footer className={cn(publicSiteStyles.chrome, styles.footer)}>
      <div className={cn(styles.inner, widthClassName)}>
        <div className={styles.intro}>
          <div>
            <Link href="/" aria-label="The Timeline home">
              <Wordmark />
            </Link>
            <p>Your team's work, connected to its sources.</p>
          </div>
          <div className={styles.utilities}>
            <GitHubSourceLink appearance="inline" label="GitHub" />
            {showAccountActions && (
              <PublicSessionBranch
                signedOut={
                  <Link href="/sign-in" data-public-analytics-cta="sign_in">
                    Sign in
                  </Link>
                }
                signedIn={
                  <Link href="/app" data-public-analytics-cta="open_dashboard">
                    Dashboard
                  </Link>
                }
              />
            )}
          </div>
        </div>
        <nav aria-label="Explore The Timeline">
          <PublicFooterColumns
            currentSection={currentSection}
            itemClassName={styles.link}
            activeItemClassName={styles.active}
          />
        </nav>
        <div className={styles.bottom}>
          <span>© {new Date().getFullYear()} The Timeline</span>
          <nav aria-label="Legal and privacy">
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/cookies">Cookies</Link>
            <CookieSettingsButton />
          </nav>
        </div>
      </div>
    </footer>
  );
}
