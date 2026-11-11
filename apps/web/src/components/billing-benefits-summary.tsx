import { formatEuroFromCents, PLAN_CATALOG } from '@timeline/shared/billing/catalog';

import type { BillingPresentation, BillingPeriod, RecordedCharges } from '@timeline/shared/billing';
import type { ReactNode } from 'react';

function billingDate(value: string): string {
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
      {credit.status !== 'not_applicable' ? <IncludedUsageCredit credit={credit} /> : null}
      {<BillingRecordedCharges charges={charges} summary={summary} credit={credit} />}
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
        <BillingSpendCapSummary cap={cap} summary={summary} />
      ) : null}
    </div>
  );
}

function BillingSpendCapSummary({
  cap,
  summary,
}: {
  cap: {
    applicable: boolean;
    exemption: 'enterprise_contract' | 'shadow_billing' | 'free_plan' | null;
    usedCents: number;
    limitCents: number;
    percent: number;
    reached: boolean;
  };
  summary: BillingPresentation;
}) {
  return (
    <section className="space-y-1 text-sm" aria-label="Monthly spend cap">
      <p>
        Monthly spend cap: <Money value={cap.usedCents} /> used of <Money value={cap.limitCents} />
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
  );
}
function IncludedUsageCredit({
  credit,
}: {
  credit: {
    status: 'available' | 'updating' | 'not_applicable';
    period: BillingPeriod | null;
    totalCents: number;
    usedCents: number | null;
    remainingCents: number | null;
  };
}) {
  return (
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
        Shared across eligible usage meters. Extra members and the plan fee are charged separately.
      </p>
    </section>
  );
}
function BillingRecordedCharges({
  charges,
  summary,
  credit,
}: {
  charges: BillingPresentation['charges'];
  summary: BillingPresentation;
  credit: BillingPresentation['credit'];
}) {
  return (
    <section className="space-y-2" aria-label="Charges recorded so far">
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
        <RecordedChargeAmounts credit={credit} amounts={charges.amounts} summary={summary} />
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
  );
}

function RecordedChargeAmounts({
  credit,
  amounts,
  summary,
}: {
  credit: BillingPresentation['credit'];
  amounts: RecordedCharges;
  summary: BillingPresentation;
}) {
  return (
    <dl className="space-y-2 text-sm">
      {credit.totalCents > 0 || amounts.creditAppliedCents > 0 ? (
        <div className="flex flex-wrap justify-between gap-2">
          <dt>Usage before included credit</dt>
          <dd>
            <Money value={amounts.usageCents} />
          </dd>
        </div>
      ) : null}
      {credit.totalCents > 0 || amounts.creditAppliedCents > 0 ? (
        <div className="flex flex-wrap justify-between gap-2">
          <dt>Included credit applied</dt>
          <dd>
            −<Money value={amounts.creditAppliedCents} />
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
          <Money value={amounts.usageAfterCreditCents} />
        </dd>
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <dt>Extra members</dt>
        <dd>
          <Money value={amounts.extraMemberCents} />
        </dd>
      </div>
      <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-2 font-medium">
        <dt>Total recorded usage charges</dt>
        <dd>
          <Money value={amounts.totalCents} />
        </dd>
      </div>
    </dl>
  );
}

export function BillingUsageOverview({
  summary,
  children,
}: {
  summary: BillingPresentation;
  children: ReactNode;
}) {
  return (
    <div className="space-y-8">
      <UsagePlanSummary summary={summary} />
      {summary.credit.status !== 'not_applicable' ? (
        <IncludedUsageCredit credit={summary.credit} />
      ) : null}
      <section aria-labelledby="usage-meters-heading" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="usage-meters-heading" className="text-base font-semibold">
            {summary.allowances.length > 0 ? 'Monthly allowances' : 'Usage by meter'}
          </h2>
          {summary.allowances.length > 0 ? (
            <p className="text-xs text-fg-muted">
              Resets {billingDate(summary.calendarPeriod.end)} (UTC)
            </p>
          ) : null}
        </div>
        {children}
      </section>
      {summary.planId !== 'free' && summary.cap.applicable ? (
        <BillingSpendCapSummary cap={summary.cap} summary={summary} />
      ) : null}
      <details className="group rounded-lg bg-surface p-5">
        <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Billing details
        </summary>
        <div className="mt-4">
          <BillingRecordedCharges
            charges={summary.charges}
            summary={summary}
            credit={summary.credit}
          />
          {summary.planId !== 'free' && !summary.cap.applicable ? (
            <p className="mt-3 text-sm text-fg-muted">
              {summary.cap.exemption === 'enterprise_contract'
                ? 'Spend limits follow your Enterprise agreement; no local spend cap applies.'
                : 'Spending limit tracking is informational; the local cap is not currently enforced.'}
            </p>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function UsagePlanSummary({ summary }: { summary: BillingPresentation }) {
  return (
    <dl className="grid gap-6 sm:grid-cols-3">
      <div className="space-y-2">
        <dt className="text-xs text-fg-muted">Current plan</dt>
        <dd className="text-xl font-semibold">
          {PLAN_CATALOG[summary.planId].name}
          {summary.comped ? ' · Comped' : ''}
        </dd>
        <dd className="text-xs text-fg-muted">
          Plan fee: <Money value={summary.recurringFeeCents} />
          {summary.recurringFeeCents === null ? '' : ' / month'}
        </dd>
      </div>
      <div className="space-y-2">
        <dt className="text-xs text-fg-muted">Members</dt>
        <dd className="font-mono text-xl">
          {summary.members.current}
          <span className="ml-2 font-sans text-sm font-normal text-fg-muted">
            / {summary.members.included ?? 'Custom'} included
          </span>
        </dd>
        <dd className="text-xs text-fg-muted">
          {summary.planId === 'free' ? (
            'Upgrade to add more members.'
          ) : (
            <>
              Extra member: <Money value={summary.members.additionalMemberCents} />
              {summary.members.additionalMemberCents === null ? '' : ' / month, prorated'}
            </>
          )}
        </dd>
      </div>
      <div className="space-y-2">
        <dt className="text-xs text-fg-muted">Recorded usage charges</dt>
        <dd className="font-mono text-xl">
          {summary.charges.status === 'available' && summary.charges.amounts ? (
            <Money value={summary.charges.amounts.totalCents} />
          ) : summary.charges.status === 'updating' ? (
            'Updating'
          ) : (
            'Unavailable'
          )}
        </dd>
        <dd className="text-xs text-fg-muted">Excludes plan fee, adjustments and tax.</dd>
      </div>
    </dl>
  );
}
