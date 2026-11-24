'use client';

import type { BillingPresentation, BillingPeriod, RecordedCharges } from '@timeline/shared/billing';
import { PLAN_CATALOG, TEAM_MONTHLY_USAGE_PER_SEAT_CENTS } from '@timeline/shared/billing/catalog';
import type { ReactNode } from 'react';

import { useRegionalFormat } from '@/components/workspace-timezone-context';
import {
  formatDisplayCurrency,
  formatDisplayNumber,
  formatDisplayPercent,
} from '@/lib/regional-format';

import { RegionalDate } from '@/components/regional-date';
import { RegionalNumber } from '@/components/regional-number';

function Period({ value }: { value: BillingPeriod }) {
  return (
    <p className="text-xs text-fg-muted">
      <RegionalDate value={value.start} timezone="UTC" /> to{' '}
      <RegionalDate value={new Date(new Date(value.end).getTime() - 1)} timezone="UTC" /> (UTC)
    </p>
  );
}
function Money({ value, usd = false }: { value: number | null; usd?: boolean }) {
  return (
    <span className="font-mono">
      {value === null ? (
        'Custom'
      ) : (
        <RegionalNumber value={value} currency={usd ? 'USD' : 'EUR'} compactCurrency />
      )}
    </span>
  );
}
export function BillingBenefitsSummary({ summary }: { summary: BillingPresentation }) {
  const { credit, charges, cap } = summary;
  return (
    <div className="space-y-6" data-billing-benefits>
      {summary.includedUsage ? <IncludedUsageSummary summary={summary} /> : null}
      {summary.allowances.length > 0 ? (
        <p className="text-sm text-fg-muted">
          Monthly allowances reset{' '}
          <RegionalDate value={summary.calendarPeriod.end} timezone="UTC" /> (UTC). Each meter has
          its own allowance.
        </p>
      ) : null}
      {credit.status !== 'not_applicable' ? <IncludedUsageCredit credit={credit} /> : null}
      <div className="rounded-lg bg-surface p-5">
        <BillingRecordedCharges charges={charges} summary={summary} credit={credit} />
      </div>
      <BillingMembersSummary summary={summary} />
      {summary.planId !== 'free' && !cap.applicable ? (
        <p className="text-sm text-fg-muted">
          {cap.exemption === 'enterprise_contract'
            ? 'Spend limits follow your Enterprise agreement; no local spend cap applies.'
            : 'Spending limit tracking is informational; the local cap is not currently enforced.'}
        </p>
      ) : null}
      {summary.planId !== 'free' && summary.paidSeats === undefined && cap.applicable ? (
        <BillingSpendCapSummary cap={cap} summary={summary} />
      ) : null}
    </div>
  );
}

function BillingMembersSummary({ summary }: { summary: BillingPresentation }) {
  const { members, paidSeats } = summary;
  const { locale } = useRegionalFormat();
  return (
    <section className="space-y-2 rounded-lg bg-surface p-5 text-sm" aria-label="Included members">
      <h3 className="text-sm font-medium">Members</h3>
      <p>
        {paidSeats === undefined
          ? `Members: ${formatDisplayNumber(members.current, locale)} current · ${members.included === null ? 'Custom' : formatDisplayNumber(members.included, locale)} included`
          : `${formatDisplayNumber(members.current, locale)} full members · ${formatDisplayNumber(paidSeats, locale)} paid seats`}
      </p>
      {summary.planId === 'free' ? (
        <p className="text-fg-muted">Upgrade to add members above the Free plan limit.</p>
      ) : paidSeats === undefined ? (
        <p className="text-fg-muted">
          Extra member price: <Money value={members.additionalMemberCents} />
          {members.additionalMemberCents === null ? '' : ' per member / month, prorated'}
        </p>
      ) : members.current > paidSeats ? (
        <p className="text-fg-muted">
          The full-member count exceeds confirmed paid seats. Review the subscription before adding
          members.
        </p>
      ) : null}
    </section>
  );
}

export function IncludedUsageSummary({ summary }: { summary: BillingPresentation }) {
  const { locale } = useRegionalFormat();
  const usage = summary.includedUsage;
  if (!usage) return null;
  const isTeam = summary.paidSeats !== undefined;
  const percent =
    usage.remainingCents === null
      ? null
      : Math.round((1 - usage.remainingCents / usage.totalCents) * 100);
  const paused =
    usage.remainingCents === 0 && (!isTeam || summary.cap.usedCents >= summary.cap.limitCents);
  return (
    <section className="space-y-2 rounded-lg bg-surface p-5 text-sm" aria-label="Included usage">
      <h3 className="font-medium">Included usage</h3>
      {percent === null ? (
        <p>Waiting for billing renewal confirmation.</p>
      ) : (
        <>
          <div
            role="progressbar"
            aria-label="Included usage"
            aria-valuenow={percent}
            className="h-1 overflow-hidden rounded-sm bg-border"
          >
            <div className="h-full bg-fg-muted" style={{ width: `${percent}%` }} />
          </div>
          <p>
            {formatDisplayPercent(percent / 100, locale)} used
            {usage.resetAt ? (
              <>
                {' '}
                · Resets <RegionalDate value={usage.resetAt} timezone="UTC" /> (UTC)
              </>
            ) : null}
          </p>
        </>
      )}
      <p className="text-fg-muted">
        {summary.cap.limitCents > 0 && isTeam
          ? `Additional usage this month: ${formatDisplayCurrency(summary.cap.usedCents, 'USD', locale, true)} of ${formatDisplayCurrency(summary.cap.limitCents, 'USD', locale, true)} cap.`
          : 'Additional spending is off.'}
      </p>
      {paused ? (
        <p>
          New AI processing and meeting capture are paused. Your existing records are available.
        </p>
      ) : null}
      <details>
        <summary className="cursor-pointer">How usage is calculated</summary>
        <p className="mt-2 text-fg-muted">
          {isTeam
            ? `Each paid seat contributes ${formatDisplayCurrency(TEAM_MONTHLY_USAGE_PER_SEAT_CENTS, 'USD', locale, true)} in monthly usage at internal rates.`
            : `Free includes ${formatDisplayCurrency(usage.totalCents, 'USD', locale, true)} in monthly usage at internal rates.`}{' '}
          AI uses four times reported model cost. Native meeting capture uses three cents per
          minute. Background analysis uses the same allowance.
        </p>
      </details>
    </section>
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
    <section className="space-y-2 rounded-lg bg-surface p-5 text-sm" aria-label="Monthly spend cap">
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
      {cap.limitCents === 0 ? (
        <p>
          New chargeable usage is paused at a{' '}
          <RegionalNumber value={0} currency="EUR" compactCurrency /> cap.
        </p>
      ) : null}
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
    <section className="space-y-3 rounded-lg bg-surface p-5" aria-label="Included usage credit">
      <h3 className="text-sm font-medium">Included usage credit</h3>
      {credit.period ? (
        <>
          <Period value={credit.period} />
          <p className="text-xs text-fg-muted">
            Credit renews <RegionalDate value={credit.period.end} timezone="UTC" /> (UTC).
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
        Recurring plan fee:{' '}
        {summary.paidSeats !== undefined && summary.recurringFeeCents !== null ? (
          <Money usd value={summary.recurringFeeCents} />
        ) : (
          <Money value={summary.recurringFeeCents} />
        )}
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
            <Money usd={summary.paidSeats !== undefined} value={amounts.usageCents} />
          </dd>
        </div>
      ) : null}
      {credit.totalCents > 0 || amounts.creditAppliedCents > 0 ? (
        <div className="flex flex-wrap justify-between gap-2">
          <dt>Included credit applied</dt>
          <dd>
            −<Money usd={summary.paidSeats !== undefined} value={amounts.creditAppliedCents} />
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
          <Money usd={summary.paidSeats !== undefined} value={amounts.usageAfterCreditCents} />
        </dd>
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <dt>Extra members</dt>
        <dd>
          <Money usd={summary.paidSeats !== undefined} value={amounts.extraMemberCents} />
        </dd>
      </div>
      <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-2 font-medium">
        <dt>Total recorded usage charges</dt>
        <dd>
          <Money usd={summary.paidSeats !== undefined} value={amounts.totalCents} />
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
      <IncludedUsageSummary summary={summary} />
      {summary.credit.status !== 'not_applicable' && !summary.includedUsage ? (
        <IncludedUsageCredit credit={summary.credit} />
      ) : null}
      <section aria-labelledby="usage-meters-heading" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="usage-meters-heading" className="text-base font-semibold">
            {summary.allowances.length > 0 ? 'Monthly allowances' : 'Usage by meter'}
          </h2>
          {summary.allowances.length > 0 ? (
            <p className="text-xs text-fg-muted">
              Resets <RegionalDate value={summary.calendarPeriod.end} timezone="UTC" /> (UTC)
            </p>
          ) : null}
        </div>
        {children}
      </section>
      {summary.planId !== 'free' && summary.paidSeats === undefined && summary.cap.applicable ? (
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
          Plan fee:{' '}
          <Money
            usd={summary.paidSeats !== undefined || summary.planId === 'free'}
            value={summary.recurringFeeCents}
          />
          {summary.recurringFeeCents === null ? '' : ' / month'}
        </dd>
      </div>
      <UsageMemberCount summary={summary} />
      <div className="space-y-2">
        <dt className="text-xs text-fg-muted">Recorded usage charges</dt>
        <dd
          className={
            summary.charges.status === 'available' ? 'font-mono text-xl' : 'text-base text-fg-muted'
          }
        >
          {summary.charges.status === 'available' && summary.charges.amounts ? (
            <Money
              usd={summary.paidSeats !== undefined}
              value={summary.charges.amounts.totalCents}
            />
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

function UsageMemberCount({ summary }: { summary: BillingPresentation }) {
  return (
    <div className="space-y-2">
      <dt className="text-xs text-fg-muted">Members</dt>
      <dd className="font-mono text-xl">
        {summary.members.current}
        <span className="ml-2 font-sans text-sm font-normal text-fg-muted">
          {summary.paidSeats !== undefined
            ? `full members · ${summary.paidSeats} paid seats`
            : `/ ${summary.members.included ?? 'Custom'} included`}
        </span>
      </dd>
      <dd className="text-xs text-fg-muted">
        {summary.planId === 'free' ? (
          'Upgrade to add more members.'
        ) : summary.paidSeats !== undefined ? null : (
          <>
            Extra member: <Money value={summary.members.additionalMemberCents} />
            {summary.members.additionalMemberCents === null ? '' : ' / month, prorated'}
          </>
        )}
      </dd>
    </div>
  );
}
