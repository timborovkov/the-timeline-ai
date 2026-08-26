'use client';

import {
  formatEuroFromCents,
  PREPAID_TOPUP_CENTS,
  planUsesPrepaidWallet,
  type BillingPlanId,
} from '@timeline/shared/billing/catalog';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useReducer, useTransition } from 'react';

import type { CheapestPlanPreview } from '@timeline/shared/billing/preview';
import type {
  BillingNudge,
  FreeAllowanceRemaining,
  PlanCapacityUsageRow,
  SpendCapUtilization,
} from '@timeline/shared/billing/status';

import {
  startBillingCheckout,
  startWalletTopUp,
  updateBillingAutoReload,
  updateBillingSpendCap,
} from '@/app/actions/billing';
import { BillingPlanPreview } from '@/components/billing-plan-preview';
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
  capacityUsage: PlanCapacityUsageRow[];
  utilization: SpendCapUtilization;
  freeRemaining: FreeAllowanceRemaining;
  nudge: BillingNudge | null;
  costBearingPaused: boolean;
  polarConfigured: boolean;
  polarTopUpConfigured: boolean;
  canManage: boolean;
  autoReloadEnabled: boolean;
  autoReloadThresholdCents: number | null;
  autoReloadAmountCents: number | null;
  planPreview: CheapestPlanPreview;
  activeMemberCount: number;
}

interface BillingFormState {
  spendCapDraft: string | null;
  autoReloadEnabledDraft: boolean | null;
  autoReloadThresholdDraft: string | null;
  error: string | null;
  message: string | null;
}

const INITIAL_BILLING_FORM: BillingFormState = {
  spendCapDraft: null,
  autoReloadEnabledDraft: null,
  autoReloadThresholdDraft: null,
  error: null,
  message: null,
};

function billingFormReducer(
  state: BillingFormState,
  patch: Partial<BillingFormState>,
): BillingFormState {
  return { ...state, ...patch };
}

function clearNotices(): Partial<BillingFormState> {
  return { error: null, message: null };
}

export function BillingSettingsPanel(props: BillingSettingsPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, updateForm] = useReducer(billingFormReducer, INITIAL_BILLING_FORM);
  const spendCapEuros = form.spendCapDraft ?? String(props.spendCapCents / 100);
  const autoReloadEnabled = form.autoReloadEnabledDraft ?? props.autoReloadEnabled;
  const autoReloadThresholdEuros =
    form.autoReloadThresholdDraft ?? String((props.autoReloadThresholdCents ?? 500) / 100);
  const { error, message } = form;

  const available = Math.max(0, props.walletBalanceCents - props.reservedBalanceCents);
  const walletPlan = planUsesPrepaidWallet(props.planId);

  function runCheckout(plan: 'payg' | 'team' | 'business') {
    updateForm(clearNotices());
    startTransition(async () => {
      const result = await startBillingCheckout({ plan });
      if (!result.ok) {
        updateForm({ error: result.error });
        return;
      }
      window.location.href = result.url;
    });
  }

  function saveSpendCap() {
    updateForm(clearNotices());
    const euros = Number(spendCapEuros);
    if (!Number.isFinite(euros) || euros < 0) {
      updateForm({ error: 'Enter a non-negative spend cap in euros.' });
      return;
    }
    startTransition(async () => {
      const result = await updateBillingSpendCap({ spendCapCents: Math.round(euros * 100) });
      if (!result.ok) {
        updateForm({ error: result.error });
        return;
      }
      updateForm({ message: 'Spend cap updated.', spendCapDraft: null });
      router.refresh();
    });
  }

  function buyTopUp() {
    updateForm(clearNotices());
    startTransition(async () => {
      const result = await startWalletTopUp();
      if (!result.ok) {
        updateForm({ error: result.error });
        return;
      }
      window.location.href = result.url;
    });
  }

  function saveAutoReload() {
    updateForm(clearNotices());
    const thresholdEuros = Number(autoReloadThresholdEuros);
    if (autoReloadEnabled && (!Number.isFinite(thresholdEuros) || thresholdEuros < 0)) {
      updateForm({ error: 'Enter a non-negative auto-reload threshold in euros.' });
      return;
    }
    startTransition(async () => {
      const result = await updateBillingAutoReload({
        enabled: autoReloadEnabled,
        thresholdCents: Math.round(thresholdEuros * 100),
        amountCents: PREPAID_TOPUP_CENTS,
      });
      if (!result.ok) {
        updateForm({ error: result.error });
        return;
      }
      updateForm({
        message: 'Auto-reload updated.',
        autoReloadEnabledDraft: null,
        autoReloadThresholdDraft: null,
      });
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
          capacityUsage={props.capacityUsage}
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
        ) : (
          <p className="mt-3 text-sm text-fg-muted">
            Switching paid plans updates your existing Polar subscription. New checkouts are only
            used when this workspace does not already have one.
          </p>
        )}
        <p className="mt-3 text-sm text-fg-muted">
          Need procurement or an SLA?{' '}
          <Link href="/help/support" className="underline decoration-border underline-offset-4">
            Contact us for Enterprise
          </Link>
          .
        </p>
      </SettingsSection>

      <SettingsSection title="Cheapest plan this period">
        <BillingPlanPreview preview={props.planPreview} currentPlanId={props.planId} />
        <p className="mt-3 text-sm text-fg-muted">
          Preview uses {props.activeMemberCount} active members and metered usage so far this
          period. Extra members are €2 per member-month on paid self-serve plans.
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
                  updateForm({ spendCapDraft: event.target.value });
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
            {walletPlan ? (
              <button
                type="button"
                disabled={pending || !props.polarTopUpConfigured}
                onClick={buyTopUp}
                className="inline-flex min-h-11 items-center rounded-sm border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-bg disabled:opacity-50"
              >
                Add €10
              </button>
            ) : null}
          </div>
        ) : null}
        {props.canManage && walletPlan ? (
          <div className="mt-4 space-y-3">
            <label className="flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={autoReloadEnabled}
                onChange={(event) => {
                  updateForm({ autoReloadEnabledDraft: event.target.checked });
                }}
                className="size-4 rounded-sm border-border"
              />
              Auto-reload {formatEuroFromCents(PREPAID_TOPUP_CENTS)} when the wallet is low
            </label>
            {autoReloadEnabled ? (
              <>
                <p className="text-sm text-fg-muted">
                  Timeline emails owners a Polar €10 checkout when available wallet is at or below
                  this threshold, and only if remaining spend-cap headroom covers the full €10
                  product. The wallet credits after Polar <code>order.paid</code>, same as Add €10.
                </p>
                <label className="block text-sm">
                  <span className="text-fg-muted">Reload when wallet falls below (EUR)</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={autoReloadThresholdEuros}
                    onChange={(event) => {
                      updateForm({ autoReloadThresholdDraft: event.target.value });
                    }}
                    className="mt-1 block w-40 rounded-sm border border-border bg-bg px-3 py-2 font-mono text-sm text-fg"
                  />
                </label>
              </>
            ) : null}
            <button
              type="button"
              disabled={pending}
              onClick={saveAutoReload}
              className="inline-flex min-h-11 items-center rounded-sm border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-bg disabled:opacity-50"
            >
              Save auto-reload
            </button>
          </div>
        ) : null}
        <p className="mt-3 text-sm text-fg-muted">
          At 50 / 75 / 90% we show in-app warnings on Home, Usage, and Billing, and email workspace
          owners once per threshold each billing period. At 100% new cost-bearing work pauses until
          you raise the cap or the period resets (owners get a final notice). Free workspaces also
          email owners when an allowance is near or used up.{' '}
          <Link href="/pricing" className="underline-offset-4 hover:underline">
            See pricing
          </Link>
        </p>
      </SettingsSection>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {message ? <p className="text-sm text-fg-muted">{message}</p> : null}
    </div>
  );
}
