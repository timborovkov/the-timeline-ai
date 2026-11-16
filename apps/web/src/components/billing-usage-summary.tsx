import {
  FREE_ALLOWANCES,
  formatEuroFromCents,
  formatStorageGb,
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
  const scale = Math.max(used, allowance);
  const safeScale = scale > 0 ? scale : 1;
  const included = (Math.min(Math.max(used, 0), allowance) / safeScale) * 100;
  const over = (Math.max(0, used - allowance) / safeScale) * 100;
  return (
    <div className="mt-1.5 flex h-1 w-full overflow-hidden rounded-sm bg-border" aria-hidden="true">
      <div className="h-full bg-fg-muted" style={{ width: `${included}%` }} />
      <div className="h-full bg-fg" style={{ width: `${over}%` }} />
    </div>
  );
}

function formatCapacityNumber(kind: PlanCapacityKind, value: number): string {
  if (kind === 'storage_gb') return formatStorageGb(value);
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
  if (meter === 'storage_gb_month') return formatStorageGb(nativeUnits);
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
  layout = 'table',
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
  layout?: 'table' | 'cards';
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
  const liveStorage = capacityUsage.find((item) => item.kind === 'storage_gb');
  const rows = (Object.keys(METER_LABELS) as BillingMeterId[])
    .map((meter) => {
      const row = meters[meter];
      const balance = allowanceBalances?.find((item) => item.meter === meter);
      const nativeUnits =
        meter === 'storage_gb_month' && liveStorage
          ? liveStorage.used
          : (balance?.used ?? row?.nativeUnits ?? 0);
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
      {layout === 'cards' ? (
        <UsageMeterCards
          rows={rows}
          comped={comped}
          includedActiveMembers={includedActiveMembers}
          additionalMemberCents={additionalMemberCents}
        />
      ) : (
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
      )}

      {capacityUsage.length > 0 ? (
        <details
          data-billing-capacity
          className={layout === 'cards' ? 'pt-2' : 'border border-border'}
        >
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

function UsageMeterCards({
  rows,
  comped,
  includedActiveMembers,
  additionalMemberCents,
}: {
  rows: {
    meter: BillingMeterId;
    nativeUnits: number;
    customerChargeCents: number;
    allowance: number | null;
  }[];
  comped: boolean;
  includedActiveMembers?: number | null;
  additionalMemberCents?: number | null;
}) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Usage by meter">
      {rows.map((row) => {
        const hint = meterHint({ meter: row.meter, includedActiveMembers, additionalMemberCents });
        const remaining =
          row.allowance === null ? null : Math.max(0, row.allowance - row.nativeUnits);
        return (
          <li
            key={row.meter}
            data-billing-meter={row.meter}
            className="min-w-0 space-y-4 rounded-lg bg-surface p-5"
          >
            <h3 className="text-sm font-medium text-fg-muted">{METER_LABELS[row.meter]}</h3>
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="sr-only">Used: </span>
              <span className="font-mono text-2xl tracking-tight text-fg">
                {amountLabel(row.meter, row.nativeUnits)}
              </span>
              {row.allowance !== null ? (
                <span className="text-xs text-fg-muted">
                  / {amountLabel(row.meter, row.allowance)} included
                </span>
              ) : (
                <span className="text-xs text-fg-muted">used</span>
              )}
            </p>
            {row.allowance !== null ? (
              <AllowanceBar used={row.nativeUnits} allowance={row.allowance} />
            ) : null}
            <div className="space-y-1 text-xs text-fg-muted">
              {remaining !== null ? (
                <p>
                  {remaining === 0
                    ? 'Allowance used up'
                    : `${amountLabel(row.meter, remaining)} remaining`}
                </p>
              ) : null}
              {hint ? <p>{hint}</p> : null}
              {!comped && row.customerChargeCents > 0 ? (
                <p>
                  Meter charges:{' '}
                  <span className="font-mono text-fg">
                    {formatEuroFromCents(row.customerChargeCents)}
                  </span>
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
