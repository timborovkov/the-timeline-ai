import {
  FREE_ALLOWANCES,
  formatEuroFromCents,
  type BillingMeterId,
} from '@timeline/shared/billing/catalog';
import Link from 'next/link';

import type { FreeAllowanceRemaining, SpendCapUtilization } from '@timeline/shared/billing/status';

import { cn } from '@/lib/utils';

const METER_LABELS: Record<BillingMeterId, string> = {
  ai: 'AI',
  recall_minutes: 'Meeting minutes',
  email_units: 'Email units',
  storage_gb_month: 'Storage (GB-month)',
  accepted_sources: 'Accepted sources',
  member_days: 'Member-days',
};

function ProgressBar({ percent, danger }: { percent: number; danger?: boolean }) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-sm bg-border" aria-hidden="true">
      <div
        className={cn('h-full rounded-sm', danger ? 'bg-danger' : 'bg-fg-muted')}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

export function BillingUsageSummary({
  periodYm,
  planName,
  utilization,
  freeRemaining,
  planId,
  meteredSpendCents,
  meters,
  costBearingPaused,
  className,
}: {
  periodYm: string;
  planName: string;
  planId: string;
  utilization: SpendCapUtilization;
  freeRemaining: FreeAllowanceRemaining;
  meteredSpendCents: number;
  meters: Partial<Record<string, { nativeUnits: number; customerChargeCents: number }>>;
  costBearingPaused: boolean;
  className?: string;
}) {
  const capPercent = utilization.percent ?? 0;
  const showCap = utilization.spendCapCents > 0;

  return (
    <div className={cn('space-y-5', className)}>
      {costBearingPaused ? (
        <p
          data-billing-paused
          className="border border-border bg-surface-2 px-4 py-3 text-sm leading-6 text-fg-muted"
        >
          Cost-bearing work is paused for this workspace. Reading, deletion, billing management, and
          export remain available.
        </p>
      ) : null}

      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="border border-border bg-bg px-4 py-3">
          <p className="text-fg-muted">Plan</p>
          <p className="mt-1 font-medium text-fg">{planName}</p>
          <p className="mt-1 font-mono text-xs text-fg-dim">{periodYm}</p>
        </div>
        <div className="border border-border bg-bg px-4 py-3">
          <p className="text-fg-muted">Metered this period</p>
          <p className="mt-1 font-mono text-lg text-fg">{formatEuroFromCents(meteredSpendCents)}</p>
        </div>
        <div className="border border-border bg-bg px-4 py-3">
          <p className="text-fg-muted">{showCap ? 'Spend cap' : 'Free AI allowance'}</p>
          <p className="mt-1 font-mono text-lg text-fg">
            {showCap
              ? formatEuroFromCents(utilization.spendCapCents)
              : formatEuroFromCents(FREE_ALLOWANCES.aiChargeCents)}
          </p>
        </div>
      </div>

      {showCap ? (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-fg-muted">Cap utilization</span>
            <span className="font-mono text-fg">{capPercent}%</span>
          </div>
          <ProgressBar percent={capPercent} danger={capPercent >= 90} />
        </div>
      ) : null}

      {planId === 'free' ? (
        <div className="space-y-3 border border-border bg-bg p-4">
          <p className="text-sm font-medium text-fg">Free allowance remaining</p>
          <ul className="grid gap-3 text-sm sm:grid-cols-2">
            <li>
              <div className="flex justify-between gap-2 text-fg-muted">
                <span>AI</span>
                <span className="font-mono text-fg">
                  {formatEuroFromCents(freeRemaining.aiChargeCents)}
                </span>
              </div>
              <ProgressBar
                percent={
                  ((FREE_ALLOWANCES.aiChargeCents - freeRemaining.aiChargeCents) /
                    FREE_ALLOWANCES.aiChargeCents) *
                  100
                }
                danger={freeRemaining.aiChargeCents <= 0}
              />
            </li>
            <li>
              <div className="flex justify-between gap-2 text-fg-muted">
                <span>Meetings</span>
                <span className="font-mono text-fg">{freeRemaining.recallMinutes} min</span>
              </div>
              <ProgressBar
                percent={
                  ((FREE_ALLOWANCES.recallMinutes - freeRemaining.recallMinutes) /
                    FREE_ALLOWANCES.recallMinutes) *
                  100
                }
                danger={freeRemaining.recallMinutes <= 0}
              />
            </li>
            <li>
              <div className="flex justify-between gap-2 text-fg-muted">
                <span>Email</span>
                <span className="font-mono text-fg">
                  {freeRemaining.emailUnits.toLocaleString()}
                </span>
              </div>
              <ProgressBar
                percent={
                  ((FREE_ALLOWANCES.emailUnits - freeRemaining.emailUnits) /
                    FREE_ALLOWANCES.emailUnits) *
                  100
                }
                danger={freeRemaining.emailUnits <= 0}
              />
            </li>
            <li>
              <div className="flex justify-between gap-2 text-fg-muted">
                <span>Accepted sources</span>
                <span className="font-mono text-fg">
                  {freeRemaining.acceptedSources.toLocaleString()}
                </span>
              </div>
              <ProgressBar
                percent={
                  ((FREE_ALLOWANCES.acceptedSources - freeRemaining.acceptedSources) /
                    FREE_ALLOWANCES.acceptedSources) *
                  100
                }
                danger={freeRemaining.acceptedSources <= 0}
              />
            </li>
            <li>
              <div className="flex justify-between gap-2 text-fg-muted">
                <span>Storage</span>
                <span className="font-mono text-fg">{freeRemaining.storageGb} GB</span>
              </div>
              <ProgressBar
                percent={
                  ((FREE_ALLOWANCES.storageGb - freeRemaining.storageGb) /
                    FREE_ALLOWANCES.storageGb) *
                  100
                }
                danger={freeRemaining.storageGb <= 0}
              />
            </li>
          </ul>
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-sm font-medium text-fg">Meters this period</p>
        {Object.keys(meters).length === 0 ? (
          <p className="text-sm text-fg-muted">
            No metered usage recorded yet this month.{' '}
            <Link href="/pricing" className="underline-offset-4 hover:underline">
              See pricing
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-border border border-border text-sm">
            {Object.entries(meters).map(([meter, row]) => {
              if (!row) return null;
              const label = meter in METER_LABELS ? METER_LABELS[meter as BillingMeterId] : meter;
              return (
                <li key={meter} className="flex items-center justify-between gap-4 px-3 py-2.5">
                  <span className="text-fg">{label}</span>
                  <span className="font-mono text-fg-muted">
                    {row.nativeUnits.toLocaleString()} ·{' '}
                    {formatEuroFromCents(row.customerChargeCents)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
