import { formatEuroFromCents } from '@timeline/shared/billing/catalog';

import type { BillingPresentation, BillingPeriod } from '@timeline/shared/billing';

export function billingDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
function Period({ value }: { value: BillingPeriod }) {
  return (
    <p className="text-xs text-fg-muted">
      {billingDate(value.start)} to{' '}
      {billingDate(new Date(new Date(value.end).getTime() - 1).toISOString())} (UTC)
    </p>
  );
}
function Money({ value }: { value: number | null }) {
  return (
    <span className="font-mono">{value === null ? 'Custom' : formatEuroFromCents(value)}</span>
  );
}
export function BillingBenefitsSummary({ summary }: { summary: BillingPresentation }) {
  const { credit, charges, cap, members } = summary;
  return (
    <div className="space-y-4" data-billing-benefits>
      {summary.allowances.length > 0 ? (
        <p className="text-sm text-fg-muted">
          Monthly allowances reset {billingDate(summary.calendarPeriod.end)} (UTC). Each meter has
          its own allowance.
        </p>
      ) : null}
      {credit.status !== 'not_applicable' ? (
        <section className="space-y-2 border border-border p-3" aria-label="Included usage credit">
          <h3 className="text-sm font-medium">Included usage credit</h3>
          {credit.period ? (
            <>
              <Period value={credit.period} />
              <p className="text-xs text-fg-muted">
                Credit renews {billingDate(credit.period.end)} (UTC).
              </p>
            </>
          ) : null}
          {credit.status === 'updating' ? (
            <p className="text-sm">Updating billing period</p>
          ) : (
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-fg-muted">Included</dt>
                <dd>
                  <Money value={credit.totalCents} />
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">Used</dt>
                <dd>
                  <Money value={credit.usedCents} />
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">Remaining</dt>
                <dd>
                  <Money value={credit.remainingCents} />
                </dd>
              </div>
            </dl>
          )}
          <p className="text-xs text-fg-muted">
            Shared across eligible usage meters. Extra members and the plan fee are charged
            separately.
          </p>
        </section>
      ) : null}
      <section className="space-y-2 border border-border p-3" aria-label="Charges recorded so far">
        <h3 className="text-sm font-medium">Charges recorded so far</h3>
        {charges.period ? <Period value={charges.period} /> : null}
        {summary.planId === 'free' ? (
          <p className="text-sm text-fg-muted">
            New Free usage is included. Any earlier paid charges remain shown.
          </p>
        ) : null}
        {summary.comped ? (
          <p className="text-sm">
            This team is comped. No new Polar usage charges; earlier paid charges remain shown.
          </p>
        ) : null}
        {charges.status !== 'available' || !charges.amounts ? (
          <p className="text-sm">
            {charges.status === 'updating'
              ? 'Updating billing period'
              : 'Unavailable — some recorded usage cannot be assigned reliably to this billing period.'}
          </p>
        ) : (
          <dl className="space-y-2 text-sm">
            {credit.totalCents > 0 || charges.amounts.creditAppliedCents > 0 ? (
              <div className="flex flex-wrap justify-between gap-2">
                <dt>Usage before included credit</dt>
                <dd>
                  <Money value={charges.amounts.usageCents} />
                </dd>
              </div>
            ) : null}
            {credit.totalCents > 0 || charges.amounts.creditAppliedCents > 0 ? (
              <div className="flex flex-wrap justify-between gap-2">
                <dt>Included credit applied</dt>
                <dd>
                  −<Money value={charges.amounts.creditAppliedCents} />
                </dd>
              </div>
            ) : null}
            <div className="flex flex-wrap justify-between gap-2">
              <dt>
                {summary.planId === 'payg'
                  ? 'Usage above Free allowances'
                  : summary.planId === 'free'
                    ? 'Recorded usage charges'
                    : 'Usage after included credit'}
              </dt>
              <dd>
                <Money value={charges.amounts.usageAfterCreditCents} />
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt>Extra members</dt>
              <dd>
                <Money value={charges.amounts.extraMemberCents} />
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-2 font-medium">
              <dt>Total recorded usage charges</dt>
              <dd>
                <Money value={charges.amounts.totalCents} />
              </dd>
            </div>
          </dl>
        )}
        <p className="text-xs text-fg-muted">
          Recorded usage only, excluding provider adjustments and tax. Polar confirms the final
          invoice.
        </p>
        <p className="text-sm">
          Recurring plan fee: <Money value={summary.recurringFeeCents} />
          {summary.recurringFeeCents === null ? '' : ' / month'}
        </p>
      </section>
      <section className="space-y-1 text-sm" aria-label="Included members">
        <p>
          Members: {members.current} current · {members.included ?? 'Custom'} included
        </p>
        {summary.planId === 'free' ? (
          <p className="text-fg-muted">Upgrade to add members above the Free plan limit.</p>
        ) : (
          <p className="text-fg-muted">
            Extra member price: <Money value={members.additionalMemberCents} />
            {members.additionalMemberCents === null ? '' : ' per member / month, prorated'}
          </p>
        )}
      </section>
      {summary.planId !== 'free' && !cap.applicable ? (
        <p className="text-sm text-fg-muted">
          {cap.exemption === 'enterprise_contract'
            ? 'Spend limits follow your Enterprise agreement; no local spend cap applies.'
            : 'Spending limit tracking is informational; the local cap is not currently enforced.'}
        </p>
      ) : null}
      {summary.planId !== 'free' && cap.applicable ? (
        <section className="space-y-1 text-sm" aria-label="Monthly spend cap">
          <p>
            Monthly spend cap: <Money value={cap.usedCents} /> used of{' '}
            <Money value={cap.limitCents} />
          </p>
          <Period value={summary.calendarPeriod} />
          <p className="text-fg-muted">
            {summary.planId === 'payg'
              ? 'Counts usage above Free allowances and extra members.'
              : 'Counts metered usage before included credit, plus extra members.'}{' '}
            Excludes the plan fee and tax. This is a limit, not credit or an upfront charge.
          </p>
          {cap.limitCents === 0 ? <p>New chargeable usage is paused at a €0 cap.</p> : null}
        </section>
      ) : null}
    </div>
  );
}
