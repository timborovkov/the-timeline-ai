import {
  type BillingPlanId,
  FREE_ALLOWANCES,
  PLAN_CATALOG,
  SELF_SERVE_PLAN_ORDER,
  formatEuroFromCents,
  formatStorageGb,
} from '@timeline/shared/billing/catalog';
import Link from 'next/link';

import { FirstRunPath } from '@/components/marketing/first-run-path';
import styles from '@/components/marketing/pricing-page.module.css';
import { PublicSessionBranch } from '@/components/public-session-branch';

const PURPOSE: Partial<Record<BillingPlanId, string>> = {
  free: 'Try it with your first source.',
  payg: 'Keep it flexible as usage grows.',
  team: 'More room for a working team.',
  business: 'More included usage and members.',
} as const;

export function PricingPlanGrid({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className={styles.planGrid}>
        {SELF_SERVE_PLAN_ORDER.map((planId) => {
          const plan = PLAN_CATALOG[planId];
          return (
            <article key={plan.id} data-pricing-plan={plan.id} className={styles.plan}>
              <h3>{plan.name}</h3>
              <p className={styles.planPurpose}>{PURPOSE[planId] ?? plan.tagline}</p>
              <p className={styles.price}>
                {formatEuroFromCents(plan.platformFeeCents ?? 0)}
                {plan.platformFeeCents ? <span>/month</span> : null}
              </p>
              <p className={styles.priceNote}>
                {planId === 'free'
                  ? 'No card. No usage charges.'
                  : 'Platform fee + usage beyond your allowance.'}
              </p>
              <ul>
                <li>{plan.includedActiveMembers} included members</li>
                <li>
                  {plan.includedUsageDiscountCents > 0
                    ? `Up to ${formatEuroFromCents(plan.includedUsageDiscountCents)} usage credit / month`
                    : `${formatEuroFromCents(FREE_ALLOWANCES.aiChargeCents)} AI + ${FREE_ALLOWANCES.acceptedSources.toLocaleString('en-IE')} source units / month`}
                </li>
                <li>
                  {planId === 'free'
                    ? 'Stops at your allowance or capacity limit'
                    : `${formatEuroFromCents(plan.additionalMemberCents ?? 0)} per extra member / month`}
                </li>
              </ul>
              <PublicSessionBranch
                signedOut={
                  <Link
                    data-public-analytics-cta={`choose_${planId}`}
                    href={planId === 'free' ? plan.cta.href : `/sign-up?plan=${planId}`}
                    className={styles.planAction}
                  >
                    {planId === 'payg' ? 'Add payment' : plan.cta.label}
                  </Link>
                }
                signedIn={
                  <Link
                    href={`/app/team?section=billing&plan=${planId}#change-plan`}
                    className={styles.planAction}
                  >
                    {planId === 'free' ? 'Open billing' : 'Manage plan'}
                  </Link>
                }
              />
            </article>
          );
        })}
      </div>
      <div className={styles.allowances}>
        <h3>Included monthly on Free and Pay as you go</h3>
        <dl>
          <div>
            <dt>AI usage</dt>
            <dd>{formatEuroFromCents(FREE_ALLOWANCES.aiChargeCents)}</dd>
          </div>
          <div>
            <dt>meeting minutes</dt>
            <dd>{FREE_ALLOWANCES.recallMinutes}</dd>
          </div>
          <div>
            <dt>email units</dt>
            <dd>{FREE_ALLOWANCES.emailUnits}</dd>
          </div>
          <div>
            <dt>file storage</dt>
            <dd>{formatStorageGb(FREE_ALLOWANCES.storageGb)}</dd>
          </div>
          <div>
            <dt>source units</dt>
            <dd>{FREE_ALLOWANCES.acceptedSources.toLocaleString('en-IE')}</dd>
          </div>
        </dl>
        <p>
          Available on one owned workspace per verified person. Additional owned workspaces require
          a payment method. Free also has capacity limits, including {FREE_ALLOWANCES.agentTurns}{' '}
          Ask turns per month. Team and Business use the pooled usage credit shown above instead.
        </p>
      </div>
      <details className={styles.firstRun}>
        <summary>What happens after signup?</summary>
        <FirstRunPath compact />
      </details>
    </div>
  );
}
