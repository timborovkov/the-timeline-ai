'use client';

import {
  FREE_ALLOWANCES,
  PLAN_CATALOG,
  formatEuroFromCents,
  parseEuroAmountToCents,
  type BillingPlanId,
} from '@timeline/shared/billing/catalog';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useReducer, useTransition } from 'react';

import type { CheapestPlanPreview } from '@timeline/shared/billing/preview';
import type { FreeAllowanceRemaining, SpendCapUtilization } from '@timeline/shared/billing/status';

import {
  startBillingCheckout,
  startBillingPortal,
  updateBillingSpendCap,
} from '@/app/actions/billing';
import { BillingCheckoutStatus } from '@/components/billing-checkout-status';
import { BillingCompNotice } from '@/components/billing-comp-notice';
import { BILLING_NOTICE_TITLE, customerBillingState } from '@/components/billing-customer-state';
import { BillingPlanPreview } from '@/components/billing-plan-preview';
import {
  BillingRestrictionNotice,
  type BillingRestrictionReason,
} from '@/components/billing-restriction-notice';
import { BillingStateBanner } from '@/components/billing-state-banner';

const PRIMARY_CLASS =
  'inline-flex min-h-11 cursor-pointer list-none items-center rounded-sm bg-signal px-3 text-sm font-medium text-bg [&::-webkit-details-marker]:hidden';
const PLAN_BUTTON_CLASS =
  'inline-flex min-h-11 items-center rounded-sm border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-bg disabled:opacity-50';

export interface BillingSettingsPanelProps {
  checkoutReturned?: boolean;
  checkoutPlan?: string;
  planId: BillingPlanId;
  planName: string;
  billingState: string;
  restrictionReason?: BillingRestrictionReason | null;
  spendCapCents: number;
  meteredSpendCents: number;
  utilization: SpendCapUtilization;
  freeRemaining: FreeAllowanceRemaining;
  costBearingPaused: boolean;
  polarConfigured: boolean;
  /** False when this plan has no Polar subscription yet, so checkout can save a card. */
  hasPolarSubscription: boolean;
  canManage: boolean;
  planPreview: CheapestPlanPreview;
  comp: {
    planName: string;
    expired: boolean;
    reason: string | null;
    expiresOn: string | null;
  } | null;
  showOperatorLink: boolean;
  platformFeeCents?: number | null;
  hasActiveTeamDiscount?: boolean;
}

interface BillingFormState {
  spendCapDraft: string | null;
  discountCode: string;
  error: string | null;
  message: string | null;
}

const INITIAL_BILLING_FORM: BillingFormState = {
  spendCapDraft: null,
  discountCode: '',
  error: null,
  message: null,
};

function billingFormReducer(
  state: BillingFormState,
  patch: Partial<BillingFormState>,
): BillingFormState {
  return { ...state, ...patch };
}

function planPriceLabel(planId: BillingPlanId, platformFeeCents?: number | null): string {
  if (planId === 'enterprise' && (platformFeeCents === null || platformFeeCents === undefined)) {
    return 'Custom';
  }
  const cents = platformFeeCents ?? PLAN_CATALOG[planId].platformFeeCents ?? 0;
  return `${formatEuroFromCents(cents)} / month`;
}

function nextInvoiceCents(props: BillingSettingsPanelProps): number {
  if (props.comp) return 0;
  if (props.planId === 'free') return 0;
  if (props.planId === 'payg' || props.planId === 'team' || props.planId === 'business') {
    return props.planPreview.bills[props.planId].totalCents;
  }
  return (props.platformFeeCents ?? 0) + props.meteredSpendCents;
}

function freeAllowancePercent(remaining: FreeAllowanceRemaining): number {
  const fractions = [
    1 - remaining.aiChargeCents / FREE_ALLOWANCES.aiChargeCents,
    1 - remaining.recallMinutes / FREE_ALLOWANCES.recallMinutes,
    1 - remaining.emailUnits / FREE_ALLOWANCES.emailUnits,
    1 - remaining.storageGb / FREE_ALLOWANCES.storageGb,
    1 - remaining.acceptedSources / FREE_ALLOWANCES.acceptedSources,
  ];
  return Math.min(100, Math.max(0, Math.round(Math.max(0, ...fractions) * 100)));
}

function SpendBar({ percent, danger }: { percent: number; danger: boolean }) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-sm bg-border" aria-hidden="true">
      <div
        className={danger ? 'h-full rounded-sm bg-danger' : 'h-full rounded-sm bg-fg-muted'}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function ThisMonth(props: BillingSettingsPanelProps) {
  if (props.planId === 'free') {
    const percent = freeAllowancePercent(props.freeRemaining);
    return (
      <div data-billing-spend>
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-fg-muted">Allowance</span>
          <span className="font-mono text-fg">{percent}%</span>
        </div>
        <SpendBar percent={percent} danger={percent >= 100} />
      </div>
    );
  }
  if (props.spendCapCents <= 0) {
    return (
      <div className="flex items-baseline justify-between gap-3 text-sm" data-billing-spend>
        <span className="text-fg-muted">This month</span>
        <span className="font-mono text-fg">{formatEuroFromCents(props.meteredSpendCents)}</span>
      </div>
    );
  }
  const percent = props.utilization.percent ?? 0;
  return (
    <div data-billing-spend>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-fg-muted">This month</span>
        <span className="font-mono text-fg">
          {formatEuroFromCents(props.meteredSpendCents)} of{' '}
          {formatEuroFromCents(props.spendCapCents)}
        </span>
      </div>
      <SpendBar percent={percent} danger={percent >= 90} />
    </div>
  );
}

export function BillingSettingsPanel(props: BillingSettingsPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, updateForm] = useReducer(billingFormReducer, INITIAL_BILLING_FORM);
  const spendCapEuros = form.spendCapDraft ?? String(props.spendCapCents / 100);
  const paymentFailed = props.billingState === 'past_due' || props.billingState === 'payment_retry';
  const state = customerBillingState({
    planId: props.planId,
    billingState: props.billingState,
    costBearingPaused: props.costBearingPaused,
    freeRemaining: props.freeRemaining,
    spendCapCents: props.spendCapCents,
    meteredSpendCents: props.meteredSpendCents,
    warnPercent: props.utilization.percent,
  });
  const checkoutActive =
    props.hasPolarSubscription &&
    props.planId !== 'free' &&
    props.billingState === `${props.planId}_active` &&
    (!props.checkoutPlan || props.checkoutPlan === props.planId);
  const checkoutPending = Boolean(props.checkoutReturned && !checkoutActive);
  const selfServe = props.canManage && props.comp === null && props.planId !== 'enterprise';
  const showPortal =
    props.canManage &&
    props.comp === null &&
    props.polarConfigured &&
    props.hasPolarSubscription &&
    !paymentFailed;

  function runCheckout(plan: 'payg' | 'team' | 'business') {
    updateForm({ error: null, message: null });
    startTransition(async () => {
      const result = await startBillingCheckout({ plan, discountCode: form.discountCode });
      if (!result.ok) {
        updateForm({ error: result.error });
        return;
      }
      window.location.href = result.url;
    });
  }

  function openPortal() {
    updateForm({ error: null, message: null });
    startTransition(async () => {
      const result = await startBillingPortal();
      if (!result.ok) {
        updateForm({ error: result.error });
        return;
      }
      window.location.href = result.url;
    });
  }

  function saveSpendCap() {
    updateForm({ error: null, message: null });
    let spendCapCents: number;
    try {
      spendCapCents = parseEuroAmountToCents(spendCapEuros);
    } catch (error) {
      updateForm({
        error: error instanceof Error ? error.message : 'Enter a non-negative spend cap in euros.',
      });
      return;
    }
    startTransition(async () => {
      const result = await updateBillingSpendCap({ spendCapCents });
      if (!result.ok) {
        updateForm({ error: result.error });
        return;
      }
      updateForm({ message: 'Spend cap updated.', spendCapDraft: null });
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {props.checkoutReturned ? (
        <BillingCheckoutStatus active={checkoutActive} planName={props.planName} />
      ) : null}
      {props.comp ? (
        <BillingCompNotice
          planName={props.comp.planName}
          expired={props.comp.expired}
          reason={props.comp.reason}
          expiresOn={props.comp.expiresOn}
        />
      ) : null}
      {state === 'payment_failed' ? (
        <BillingStateBanner title="Payment failed.">
          {props.canManage && props.polarConfigured && props.comp === null ? (
            <button
              type="button"
              disabled={pending}
              onClick={openPortal}
              className="text-sm font-medium text-fg underline-offset-4 hover:underline disabled:opacity-50"
            >
              Update payment method
            </button>
          ) : null}
        </BillingStateBanner>
      ) : null}
      {state === 'spend_cap' ? (
        <BillingStateBanner title="Spend cap reached.">
          {props.canManage && props.comp === null ? (
            <a
              href="#billing-spend-cap"
              className="text-sm font-medium text-fg underline-offset-4 hover:underline"
            >
              Raise cap
            </a>
          ) : null}
        </BillingStateBanner>
      ) : null}
      {props.restrictionReason ? (
        <BillingRestrictionNotice reason={props.restrictionReason} />
      ) : null}
      {state === 'allowance' || (state === 'paused' && !props.restrictionReason) ? (
        <BillingStateBanner title={BILLING_NOTICE_TITLE[state]} />
      ) : null}

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-fg-muted">Current plan</p>
          <p className="mt-1 text-lg font-medium text-fg">{props.planName}</p>
          <p className="mt-1 font-mono text-sm text-fg" data-billing-price>
            {planPriceLabel(props.planId, props.platformFeeCents)}
          </p>
          {props.planId === 'enterprise' && !props.hasPolarSubscription ? (
            <p className="mt-2 text-sm text-fg-muted" data-enterprise-subscription="pending">
              Subscription pending
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          {showPortal ? (
            <button type="button" disabled={pending} onClick={openPortal} className={PRIMARY_CLASS}>
              Manage payment
            </button>
          ) : null}
          {selfServe ? (
            <details
              id="change-plan"
              open={props.restrictionReason === 'free_grant_elsewhere' || undefined}
            >
              <summary
                className={`ml-auto w-fit ${
                  showPortal || paymentFailed
                    ? 'cursor-pointer text-sm text-fg-muted'
                    : PRIMARY_CLASS
                }`}
              >
                Change plan
              </summary>
              <div className="mt-3 space-y-2">
                <label htmlFor="billing-promo-code" className="block text-sm text-fg-muted">
                  Promo code
                </label>
                <input
                  id="billing-promo-code"
                  name="discountCode"
                  type="text"
                  autoComplete="off"
                  value={form.discountCode}
                  disabled={pending || props.hasActiveTeamDiscount}
                  aria-describedby="billing-promo-help"
                  onChange={(event) => {
                    updateForm({ discountCode: event.target.value });
                  }}
                  className="block w-full rounded-sm border border-border bg-bg px-3 py-2 text-sm text-fg disabled:opacity-60"
                />
                <p id="billing-promo-help" className="max-w-sm text-sm text-fg-muted">
                  {props.hasActiveTeamDiscount
                    ? 'Your assigned team discount takes priority. Promo codes cannot be combined with it.'
                    : 'Optional. Polar checks eligibility for the selected plan. An active team discount takes priority; discounts do not stack.'}
                </p>
                {props.hasPolarSubscription ? (
                  <p className="max-w-sm text-sm text-fg-muted">
                    Polar applies discount changes to existing subscriptions from the next billing
                    cycle.
                  </p>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                {(
                  [
                    ['payg', 'Pay as you go'],
                    ['team', 'Team · €49/mo'],
                    ['business', 'Business · €199/mo'],
                  ] as const
                ).map(([plan, label]) => (
                  <button
                    key={plan}
                    type="button"
                    disabled={
                      pending ||
                      checkoutPending ||
                      !props.polarConfigured ||
                      (props.planId === plan && props.hasPolarSubscription)
                    }
                    onClick={() => {
                      runCheckout(plan);
                    }}
                    className={PLAN_BUTTON_CLASS}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </div>

      <ThisMonth {...props} />

      <div data-billing-invoice>
        <p className="text-sm text-fg-muted">Next invoice</p>
        <p className="mt-1 font-mono text-sm text-fg">
          {formatEuroFromCents(nextInvoiceCents(props))}
        </p>
      </div>

      {props.comp ? null : (
        <BillingPlanPreview preview={props.planPreview} currentPlanId={props.planId} />
      )}

      {props.canManage && props.planId !== 'free' ? (
        <details id="billing-spend-cap">
          <summary className="cursor-pointer text-sm text-fg-muted hover:text-fg">
            Spend cap
          </summary>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="text-fg-muted">EUR</span>
              <input
                type="number"
                min={0}
                step={1}
                value={spendCapEuros}
                disabled={props.comp !== null}
                onChange={(event) => {
                  updateForm({ spendCapDraft: event.target.value });
                }}
                className="mt-1 block w-32 rounded-sm border border-border bg-bg px-3 py-2 font-mono text-sm text-fg disabled:opacity-60"
              />
            </label>
            {props.comp === null ? (
              <button
                type="button"
                disabled={pending}
                onClick={saveSpendCap}
                className="inline-flex min-h-11 items-center rounded-sm border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-bg disabled:opacity-50"
              >
                Save
              </button>
            ) : null}
          </div>
        </details>
      ) : null}

      <p className="text-sm">
        <Link href="/pricing" className="text-fg-muted underline-offset-4 hover:underline">
          Pricing
        </Link>
      </p>
      {props.showOperatorLink ? (
        <p className="text-sm">
          <Link
            href="/app/admin/billing"
            className="text-fg-muted underline-offset-4 hover:underline"
          >
            Operator billing
          </Link>
        </p>
      ) : null}
      {form.error ? (
        <p role="alert" className="text-sm text-danger">
          {form.error}
        </p>
      ) : null}
      {form.message ? <p className="text-sm text-fg-muted">{form.message}</p> : null}
    </div>
  );
}
