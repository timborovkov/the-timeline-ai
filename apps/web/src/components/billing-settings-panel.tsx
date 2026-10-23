'use client';

import {
  formatEuroFromCents,
  parseEuroAmountToCents,
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
  startBillingPortal,
  updateBillingSpendCap,
} from '@/app/actions/billing';
import { BillingCompNotice } from '@/components/billing-comp-notice';
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
  /** False when this plan has no Polar subscription yet, so checkout can save a card. */
  hasPolarSubscription: boolean;
  canManage: boolean;
  planPreview: CheapestPlanPreview;
  activeMemberCount: number;
  comp: {
    planName: string;
    expired: boolean;
    reason: string | null;
    expiresOn: string | null;
  } | null;
  priceNotice: string | null;
  showOperatorLink: boolean;
  includedActiveMembers?: number | null;
  additionalMemberCents?: number | null;
  platformFeeCents?: number | null;
}

interface BillingFormState {
  spendCapDraft: string | null;
  error: string | null;
  message: string | null;
}

const INITIAL_BILLING_FORM: BillingFormState = {
  spendCapDraft: null,
  error: null,
  message: null,
};

const PLAN_BUTTON_CLASS =
  'inline-flex min-h-11 items-center rounded-sm border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-bg disabled:opacity-50';

function billingFormReducer(
  state: BillingFormState,
  patch: Partial<BillingFormState>,
): BillingFormState {
  return { ...state, ...patch };
}

function clearNotices(): Partial<BillingFormState> {
  return { error: null, message: null };
}

function BillingPlanSection(props: {
  planId: BillingPlanId;
  planName: string;
  billingState: string;
  shadowBilling: boolean;
  polarConfigured: boolean;
  hasPolarSubscription: boolean;
  canManage: boolean;
  pending: boolean;
  comp: BillingSettingsPanelProps['comp'];
  priceNotice: string | null;
  showOperatorLink: boolean;
  platformFeeCents?: number | null;
  onCheckout: (plan: 'payg' | 'team' | 'business') => void;
}) {
  return (
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
      {props.comp ? (
        <div className="mt-4">
          <BillingCompNotice
            planName={props.comp.planName}
            expired={props.comp.expired}
            reason={props.comp.reason}
            expiresOn={props.comp.expiresOn}
          />
        </div>
      ) : null}
      {props.priceNotice ? <p className="mt-3 text-sm text-fg">{props.priceNotice}</p> : null}
      {props.showOperatorLink ? (
        <p className="mt-3 text-sm">
          <Link href="/app/admin/billing" className="underline-offset-4 hover:underline">
            Operator billing controls
          </Link>
        </p>
      ) : null}
      {props.billingState === 'past_due' || props.billingState === 'payment_retry' ? (
        <p className="mt-4 rounded-sm border border-border bg-bg px-3 py-2 text-sm text-fg">
          Payment failed. New cost-bearing work is paused until the card on file succeeds. Reading
          and export stay available.
        </p>
      ) : null}
      {props.canManage && !props.comp && props.planId !== 'enterprise' ? (
        <div className="mt-4 flex flex-wrap gap-2">
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
                props.pending ||
                !props.polarConfigured ||
                (props.planId === plan && props.hasPolarSubscription)
              }
              onClick={() => {
                props.onCheckout(plan);
              }}
              className={PLAN_BUTTON_CLASS}
            >
              {label}
            </button>
          ))}
        </div>
      ) : props.canManage && props.comp ? (
        <p className="mt-3 text-sm text-fg-muted">
          Polar checkout is turned off while this workspace is comped.
        </p>
      ) : props.canManage ? (
        <p className="mt-3 text-sm text-fg-muted">
          Enterprise checkout is opened by a platform operator. Plan changes are not self-serve.
        </p>
      ) : (
        <p className="mt-3 text-sm text-fg-muted">Only owners and admins can change billing.</p>
      )}
      {props.planId === 'enterprise' && !props.hasPolarSubscription ? (
        <p className="mt-3 text-sm text-fg" data-enterprise-subscription="pending">
          Usage is recorded locally and invoiced after an operator attaches an active Timeline
          Enterprise subscription.
        </p>
      ) : null}
      {props.planId === 'enterprise' &&
      props.platformFeeCents !== null &&
      props.platformFeeCents !== undefined ? (
        <p className="mt-3 text-sm text-fg-muted" data-enterprise-platform-fee>
          Negotiated platform fee {formatEuroFromCents(props.platformFeeCents)} per month, invoiced
          on the Timeline Enterprise subscription.
        </p>
      ) : null}
      {props.planId === 'enterprise' ? null : !props.polarConfigured ? (
        <p className="mt-3 text-sm text-fg-muted">
          Polar checkout is not configured in this environment. Usage still records locally.
        </p>
      ) : (
        <p className="mt-3 text-sm text-fg-muted">
          Pay as you go is a €0 Polar subscription. Checkout saves the card. Usage above the Free
          floor is ingested as Polar events and invoiced monthly. Team and Business use the same
          subscription, with their platform fee and included usage discount. Switching plans updates
          the existing subscription, including when the workspace is past due.
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
  );
}

function BillingSpendSection(props: {
  includedDiscountRemainingCents: number;
  canManage: boolean;
  pending: boolean;
  comped: boolean;
  polarConfigured: boolean;
  paymentFailed: boolean;
  spendCapEuros: string;
  onSpendCapDraft: (value: string) => void;
  onSaveSpendCap: () => void;
  onOpenPortal: () => void;
}) {
  return (
    <SettingsSection title="Spend cap">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-fg-muted">Included usage discount left</dt>
          <dd className="mt-1 font-mono text-fg">
            {formatEuroFromCents(props.includedDiscountRemainingCents)}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Collection</dt>
          <dd className="mt-1 text-fg">Monthly Polar invoice on the card on file</dd>
        </div>
      </dl>
      <p className="mt-3 text-sm text-fg-muted">
        A €0 spend cap is a hard stop. Metered usage at the cap pauses new cost-bearing work and
        emails owners. Polar still invoices the usage already recorded.
      </p>
      {props.canManage ? (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="text-fg-muted">Monthly spend cap (EUR)</span>
            <input
              type="number"
              min={0}
              step={1}
              value={props.spendCapEuros}
              disabled={props.comped}
              onChange={(event) => {
                props.onSpendCapDraft(event.target.value);
              }}
              className="mt-1 block w-40 rounded-sm border border-border bg-bg px-3 py-2 font-mono text-sm text-fg disabled:opacity-60"
            />
          </label>
          {props.comped ? (
            <p className="text-sm text-fg-muted">
              Timeline operators set the spend cap on a comped workspace.
            </p>
          ) : (
            <button
              type="button"
              disabled={props.pending}
              onClick={props.onSaveSpendCap}
              className="inline-flex min-h-11 items-center rounded-sm bg-signal px-3 text-sm font-medium text-bg disabled:opacity-50"
            >
              Save cap
            </button>
          )}
          {props.paymentFailed && props.polarConfigured && !props.comped ? (
            <button
              type="button"
              disabled={props.pending}
              onClick={props.onOpenPortal}
              className="inline-flex min-h-11 items-center rounded-sm border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-bg disabled:opacity-50"
            >
              Update payment method
            </button>
          ) : null}
        </div>
      ) : null}
      <p className="mt-3 text-sm text-fg-muted">
        At 50 / 75 / 90% we show in-app warnings on Home, Usage, and Billing, and email workspace
        owners once per threshold each billing period. At 100% new cost-bearing work pauses until
        you raise the cap or the period resets (owners get a final notice). A failed subscription
        payment pauses costly work and emails owners. Free workspaces also email owners when an
        allowance is near or used up.{' '}
        <Link href="/pricing" className="underline-offset-4 hover:underline">
          See pricing
        </Link>
      </p>
    </SettingsSection>
  );
}

export function BillingSettingsPanel(props: BillingSettingsPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, updateForm] = useReducer(billingFormReducer, INITIAL_BILLING_FORM);
  const spendCapEuros = form.spendCapDraft ?? String(props.spendCapCents / 100);
  const { error, message } = form;
  const paymentFailed = props.billingState === 'past_due' || props.billingState === 'payment_retry';

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

  function openPortal() {
    updateForm(clearNotices());
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
    updateForm(clearNotices());
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
          includedActiveMembers={props.includedActiveMembers}
          additionalMemberCents={props.additionalMemberCents}
        />
      </SettingsSection>

      <BillingPlanSection
        planId={props.planId}
        planName={props.planName}
        billingState={props.billingState}
        shadowBilling={props.shadowBilling}
        polarConfigured={props.polarConfigured}
        hasPolarSubscription={props.hasPolarSubscription}
        canManage={props.canManage}
        pending={pending}
        comp={props.comp}
        priceNotice={props.priceNotice}
        showOperatorLink={props.showOperatorLink}
        platformFeeCents={props.platformFeeCents}
        onCheckout={runCheckout}
      />

      <BillingPlanPreview
        preview={props.planPreview}
        currentPlanId={props.planId}
        activeMemberCount={props.activeMemberCount}
      />

      <BillingSpendSection
        includedDiscountRemainingCents={props.includedDiscountRemainingCents}
        canManage={props.canManage}
        pending={pending}
        comped={props.comp !== null}
        polarConfigured={props.polarConfigured}
        paymentFailed={paymentFailed}
        spendCapEuros={spendCapEuros}
        onSpendCapDraft={(value) => {
          updateForm({ spendCapDraft: value });
        }}
        onSaveSpendCap={saveSpendCap}
        onOpenPortal={openPortal}
      />

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {message ? <p className="text-sm text-fg-muted">{message}</p> : null}
    </div>
  );
}
