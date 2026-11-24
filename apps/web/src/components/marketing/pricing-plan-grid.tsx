import { FREE_ALLOWANCES, TEAM_MONTHLY_SEAT_CENTS } from '@timeline/shared/billing/catalog';
import Link from 'next/link';

import styles from '@/components/marketing/pricing-page.module.css';
import { PublicSessionBranch } from '@/components/public-session-branch';

export function PricingPlanGrid() {
  return (
    <div className={styles.planGrid}>
      <article data-pricing-plan="free" className={styles.plan}>
        <h3>Free</h3>
        <p className={styles.price}>$0</p>
        <p className={styles.priceNote}>No card required.</p>
        <ul>
          <li>Up to {FREE_ALLOWANCES.activeMembers} members</li>
          <li>One monthly Included usage allowance per workspace</li>
          <li>Community support</li>
        </ul>
        <PublicSessionBranch
          signedOut={
            <Link
              data-public-analytics-cta="choose_free"
              href="/sign-up"
              className={styles.planAction}
            >
              Start free
            </Link>
          }
          signedIn={
            <Link href="/app/team?section=billing" className={styles.planAction}>
              Open billing
            </Link>
          }
        />
      </article>
      <article data-pricing-plan="team" className={styles.plan}>
        <h3>Team</h3>
        <p className={styles.price}>
          ${TEAM_MONTHLY_SEAT_CENTS / 100}
          <span> per member / month</span>
        </p>
        <p className={styles.priceNote}>Starts with one member.</p>
        <ul>
          <li>Each paid member adds to the shared Included usage allowance</li>
          <li>Optional extra usage with a monthly cap</li>
          <li>Priority email support</li>
        </ul>
        <PublicSessionBranch
          signedOut={
            <Link
              data-public-analytics-cta="choose_team"
              href="/sign-up?plan=team"
              className={styles.planAction}
            >
              Choose Team
            </Link>
          }
          signedIn={
            <Link
              href="/app/team?section=billing&plan=team#change-plan"
              className={styles.planAction}
            >
              Manage plan
            </Link>
          }
        />
      </article>
      <article data-pricing-plan="enterprise" className={styles.plan}>
        <h3>Enterprise</h3>
        <p className={styles.price}>Custom</p>
        <p className={styles.priceNote}>Quoted for your organization.</p>
        <ul>
          <li>Volume pricing and usage by agreement</li>
          <li>Managed private cloud or on-premises deployment options</li>
          <li>Setup and support by agreement</li>
        </ul>
        <Link href="/contact/enterprise" className={styles.planAction}>
          Contact sales
        </Link>
      </article>
    </div>
  );
}
