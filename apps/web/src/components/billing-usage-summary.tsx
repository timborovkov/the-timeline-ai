import {
  FREE_ALLOWANCES,
  formatEuroFromCents,
  type BillingMeterId,
} from '@timeline/shared/billing/catalog';

import type { BillingPresentation } from '@timeline/shared/billing';
import type { PlanCapacityKind, PlanCapacityUsageRow } from '@timeline/shared/billing/status';

import { cn } from '@/lib/utils';

const METER_LABELS: Record<BillingMeterId, string> = {
  ai: 'AI',
  recall_minutes: 'Meeting minutes',
  email_units: 'Email',
  storage_gb_month: 'Storage',
  accepted_sources: 'Accepted sources',
  member_days: 'Extra members',
};

const ALLOWANCE_METERS = [
  'ai',
  'recall_minutes',
  'email_units',
  'storage_gb_month',
  'accepted_sources',
] as const satisfies readonly BillingMeterId[];

function AllowanceBar({ used, allowance }: { used: number; allowance: number }) {
  const scale = Math.max(used, allowance, 1);
  const included = (Math.min(Math.max(used, 0), allowance) / scale) * 100;
  const over = (Math.max(0, used - allowance) / scale) * 100;
  return (
    <div className="mt-1.5 flex h-1 w-full overflow-hidden rounded-sm bg-border" aria-hidden="true">
      <div className="h-full bg-fg-muted" style={{ width: `${included}%` }} />
      <div className="h-full bg-fg" style={{ width: `${over}%` }} />
    </div>
  );
}

function formatCapacityNumber(kind: PlanCapacityKind, value: number): string {
  if (kind === 'storage_gb') {
    const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(2);
    return `${Number(rounded).toLocaleString('en-IE')} GB`;
  }
  return Math.round(value).toLocaleString('en-IE');
}

function formatCapacityValue(row: PlanCapacityUsageRow): string {
  if (row.limit === null) {
    return `${formatCapacityNumber(row.kind, row.used)} · Custom`;
  }
  if (row.limit === 0) {
    return row.used > 0
      ? `${formatCapacityNumber(row.kind, row.used)} · Not included`
      : 'Not included';
  }
  return `${formatCapacityNumber(row.kind, row.used)} of ${formatCapacityNumber(row.kind, row.limit)}`;
}

function allowanceLimit(meter: BillingMeterId): number | null {
  switch (meter) {
    case 'ai':
      return FREE_ALLOWANCES.aiChargeCents;
    case 'recall_minutes':
      return FREE_ALLOWANCES.recallMinutes;
    case 'email_units':
      return FREE_ALLOWANCES.emailUnits;
    case 'storage_gb_month':
      return FREE_ALLOWANCES.storageGb;
    case 'accepted_sources':
      return FREE_ALLOWANCES.acceptedSources;
    case 'member_days':
      return null;
  }
}

function amountLabel(meter: BillingMeterId, nativeUnits: number): string {
  if (meter === 'ai') return formatEuroFromCents(nativeUnits);
  if (meter === 'recall_minutes') return `${nativeUnits.toLocaleString('en-IE')} min`;
  if (meter === 'storage_gb_month') {
    const rounded = nativeUnits >= 10 ? nativeUnits.toFixed(0) : nativeUnits.toFixed(2);
    return `${Number(rounded).toLocaleString('en-IE')} GB`;
  }
  return nativeUnits.toLocaleString('en-IE');
}

function meterHint(input: {
  meter: BillingMeterId;
  includedActiveMembers?: number | null;
  additionalMemberCents?: number | null;
}): string | undefined {
  if (input.meter !== 'member_days') return undefined;
  const parts: string[] = [];
  if (input.includedActiveMembers !== null && input.includedActiveMembers !== undefined) {
    parts.push(`${input.includedActiveMembers.toLocaleString('en-IE')} included`);
  }
  if (input.additionalMemberCents !== null && input.additionalMemberCents !== undefined) {
    parts.push(`${formatEuroFromCents(input.additionalMemberCents)} each`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function BillingUsageSummary({
  planId,
  allowancesOnly = false,
  allowanceBalances,
  comped = false,
  spendCapCents,
  meteredSpendCents,
  meters,
  capacityUsage,
  includedActiveMembers,
  additionalMemberCents,
  className,
}: {
  planId: string;
  allowancesOnly?: boolean;
  allowanceBalances?: BillingPresentation['allowances'];
  comped?: boolean;
  spendCapCents?: number;
  meteredSpendCents?: number;
  meters: Partial<
    Record<
      string,
      { nativeUnits: number; customerChargeCents: number; capEligibleChargeCents?: number }
    >
  >;
  capacityUsage: PlanCapacityUsageRow[];
  includedActiveMembers?: number | null;
  additionalMemberCents?: number | null;
  className?: string;
}) {
  const rows = (Object.keys(METER_LABELS) as BillingMeterId[])
    .map((meter) => {
      const row = meters[meter];
      const balance = allowanceBalances?.find((item) => item.meter === meter);
      const nativeUnits = balance?.used ?? row?.nativeUnits ?? 0;
      const customerChargeCents =
        row?.capEligibleChargeCents ?? (planId === 'free' ? 0 : (row?.customerChargeCents ?? 0));
      const active = nativeUnits > 0 || customerChargeCents > 0;
      const showMeter =
        (ALLOWANCE_METERS as readonly string[]).includes(meter) ||
        (!allowancesOnly && planId !== 'free');
      if (!active && !showMeter) return null;
      return {
        meter,
        nativeUnits,
        customerChargeCents,
        allowance:
          balance?.included ??
          (planId === 'free' || planId === 'payg' ? allowanceLimit(meter) : null),
      };
    })
    .filter((row) => row !== null);

  return (
    <div className={cn('space-y-4', className)}>
      {planId === 'payg' &&
      !comped &&
      spendCapCents !== undefined &&
      meteredSpendCents !== undefined ? (
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <p>
            Chargeable usage this month:{' '}
            <span className="font-mono">{formatEuroFromCents(meteredSpendCents)}</span>
          </p>
          <p>
            Monthly spend cap:{' '}
            <span className="font-mono">{formatEuroFromCents(spendCapCents)}</span>
          </p>
        </div>
      ) : null}
      {!allowancesOnly && planId === 'payg' && !comped ? (
        <p className="text-sm text-fg-muted">
          Your monthly Free allowances are included. You pay for usage above each allowance and
          extra members. Charges below exclude Free-plan usage; final invoices may include discounts
          and tax.
        </p>
      ) : null}
      {comped ? (
        <p className="text-sm text-fg-muted">
          This team is comped. Usage is tracked without Polar charges.
        </p>
      ) : planId !== 'free' && planId !== 'payg' ? (
        <p className="text-sm text-fg-muted">
          Metered charges shown before included plan credit, provider discounts and tax.
        </p>
      ) : null}
      <div className="border border-border text-sm">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-4 px-3 py-2 text-fg-muted">
          <span>Meter</span>
          <span>Usage</span>
          <span className="text-right">{allowancesOnly ? 'Remaining' : 'Usage charges'}</span>
        </div>
        <ul>
          {rows.map((row) => {
            const hint = meterHint({
              meter: row.meter,
              includedActiveMembers,
              additionalMemberCents,
            });
            return (
              <li
                key={row.meter}
                data-billing-meter={row.meter}
                {...(row.meter === 'member_days' ? { 'data-billing-extra-members': '' } : {})}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 border-t border-border px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-fg" {...(hint ? { title: hint } : {})}>
                    {METER_LABELS[row.meter]}
                  </p>
                  {hint ? <p className="mt-1 text-xs text-fg-muted">{hint}</p> : null}
                  {row.allowance === null ? null : (
                    <>
                      <p className="mt-1 text-xs text-fg-muted">
                        Used: {amountLabel(row.meter, row.nativeUnits)} · Included:{' '}
                        {amountLabel(row.meter, row.allowance)} · Remaining:{' '}
                        {amountLabel(row.meter, Math.max(0, row.allowance - row.nativeUnits))}
                        {row.nativeUnits >= row.allowance ? ' · Allowance used up' : ''}
                      </p>
                      <AllowanceBar used={row.nativeUnits} allowance={row.allowance} />
                    </>
                  )}
                </div>
                <span className="font-mono text-fg-muted">
                  {amountLabel(row.meter, row.nativeUnits)}
                </span>
                <span className="text-right font-mono text-fg">
                  {allowancesOnly && row.allowance !== null
                    ? amountLabel(row.meter, Math.max(0, row.allowance - row.nativeUnits))
                    : comped
                      ? '—'
                      : formatEuroFromCents(row.customerChargeCents)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {capacityUsage.length > 0 ? (
        <details data-billing-capacity className="border border-border">
          <summary className="cursor-pointer px-3 py-2 text-sm text-fg-muted hover:text-fg">
            Infrastructure limits
          </summary>
          <ul className="border-t border-border">
            {capacityUsage.map((row) => (
              <li
                key={row.kind}
                data-capacity-kind={row.kind}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="text-fg-muted">{row.label}</span>
                <span className="font-mono text-fg">{formatCapacityValue(row)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
