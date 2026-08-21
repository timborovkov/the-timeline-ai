'use client';

import {
  formatEuroFromCents,
  type BillingNudge,
  type BillingPlanId,
  type FreeAllowanceRemaining,
  type SpendCapUtilization,
} from '@timeline/shared/billing';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { startBillingCheckout, updateBillingSpendCap } from '@/app/actions/billing';
import { BillingUpgradeNudge } from '@/components/billing-upgrade-nudge';
import { BillingUsageSummary } from '@/components/billing-usage-summary';
import { SettingsSection } from '@/components/section-heading';

export interface BillingSettingsPanelProps {
  planId: BillingPlanId;
  planName: string;
  billingState: string;
  shadowBilling: boolean;
  spendCapCents: number;
  walletBalanceCents: number;
  reservedBalanceCents: number;
  includedDiscountRemainingCents: number;
  meteredSpendCents: number;
  periodYm: string;
  meters: Partial<Record<string, { nativeUnits: number; customerChargeCents: number }>>;
  utilization: SpendCapUtilization;
  freeRemaining: FreeAllowanceRemaining;
  nudge: BillingNudge | null;
  costBearingPaused: boolean;
  polarConfigured: boolean;
  canManage: boolean;
}

export function BillingSettingsPanel(props: BillingSettingsPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [spendCapEuros, setSpendCapEuros] = useState(String(props.spendCapCents / 100));
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const available = Math.max(0, props.walletBalanceCents - props.reservedBalanceCents);

  function runCheckout(plan: 'payg' | 'team' | 'business') {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await startBillingCheckout({ plan });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      window.location.href = result.url;
    });
  }

  function saveSpendCap() {
    setError(null);
    setMessage(null);
    const euros = Number(spendCapEuros);
    if (!Number.isFinite(euros) || euros < 0) {
      setError('Enter a non-negative spend cap in euros.');
      return;
    }
    startTransition(async () => {
      const result = await updateBillingSpendCap({ spendCapCents: Math.round(euros * 100) });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage('Spend cap updated.');
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {props.nudge ? <BillingUpgradeNudge nudge={props.nudge} /> : null}

      <SettingsSection title="Usage overview">
        <BillingUsageSummary
          periodYm={props.periodYm}
          planName={props.planName}
          planId={props.planId}
          utilization={props.utilization}
          freeRemaining={props.freeRemaining}
          meteredSpendCents={props.meteredSpendCents}
          meters={props.meters}
          costBearingPaused={props.costBearingPaused}
        />
      </SettingsSection>

      <SettingsSection title="Plan">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-fg-muted">Current plan</dt>
            <dd className="mt-1 font-medium text-fg">{props.planName}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Billing state</dt>
            <dd className="mt-1 font-mono text-fg">{props.billingState}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Mode</dt>
            <dd className="mt-1 text-fg">
              {props.shadowBilling
                ? 'Shadow billing (usage recorded; Free hard stops still apply)'
                : 'Live charges enabled'}
            </dd>
          </div>
        </dl>
        {props.canManage ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !props.polarConfigured || props.planId === 'payg'}
              onClick={() => {
                runCheckout('payg');
              }}
              className="inline-flex min-h-11 items-center rounded-sm border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-bg disabled:opacity-50"
            >
              Pay as you go
            </button>
            <button
              type="button"
              disabled={pending || !props.polarConfigured || props.planId === 'team'}
              onClick={() => {
                runCheckout('team');
              }}
              className="inline-flex min-h-11 items-center rounded-sm border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-bg disabled:opacity-50"
            >
              Team · €49/mo
            </button>
            <button
              type="button"
              disabled={pending || !props.polarConfigured || props.planId === 'business'}
              onClick={() => {
                runCheckout('business');
              }}
              className="inline-flex min-h-11 items-center rounded-sm border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-bg disabled:opacity-50"
            >
              Business · €199/mo
            </button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-fg-muted">Only owners and admins can change billing.</p>
        )}
        {!props.polarConfigured ? (
          <p className="mt-3 text-sm text-fg-muted">
            Polar checkout is not configured in this environment. Usage still records locally.
          </p>
        ) : null}
        <p className="mt-3 text-sm text-fg-muted">
          Need procurement or an SLA?{' '}
          <Link href="/help/support" className="underline decoration-border underline-offset-4">
            Contact us for Enterprise
          </Link>
          .
        </p>
      </SettingsSection>

      <SettingsSection title="Wallet and spend cap">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-fg-muted">Wallet</dt>
            <dd className="mt-1 font-mono text-fg">{formatEuroFromCents(available)}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Reserved</dt>
            <dd className="mt-1 font-mono text-fg">
              {formatEuroFromCents(props.reservedBalanceCents)}
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">Included discount left</dt>
            <dd className="mt-1 font-mono text-fg">
              {formatEuroFromCents(props.includedDiscountRemainingCents)}
            </dd>
          </div>
        </dl>
        {props.canManage ? (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="text-fg-muted">Monthly spend cap (EUR)</span>
              <input
                type="number"
                min={0}
                step={1}
                value={spendCapEuros}
                onChange={(event) => {
                  setSpendCapEuros(event.target.value);
                }}
                className="mt-1 block w-40 rounded-sm border border-border bg-bg px-3 py-2 font-mono text-sm text-fg"
              />
            </label>
            <button
              type="button"
              disabled={pending}
              onClick={saveSpendCap}
              className="inline-flex min-h-11 items-center rounded-sm bg-signal px-3 text-sm font-medium text-bg disabled:opacity-50"
            >
              Save cap
            </button>
          </div>
        ) : null}
        <p className="mt-3 text-sm text-fg-muted">
          At 50 / 75 / 90% we warn owners. At 100% new cost-bearing work pauses until you raise the
          cap or the period resets.
        </p>
      </SettingsSection>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {message ? <p className="text-sm text-fg-muted">{message}</p> : null}
    </div>
  );
}
