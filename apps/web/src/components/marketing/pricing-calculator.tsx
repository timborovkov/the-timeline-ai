'use client';

import { PLAN_CATALOG, formatEuroFromCents } from '@timeline/shared/billing/catalog';
import Link from 'next/link';
import { useState } from 'react';

import type { SelfServePaidPlanId } from '@timeline/shared/billing/preview';

import {
  CALCULATOR_PLANS,
  EXAMPLE_USAGE,
  USAGE_FIELDS,
  estimatePricing,
  parseUsage,
  type UsageDraft,
  type UsageKey,
} from '@/lib/pricing-calculator';
import { cn } from '@/lib/utils';

const CONTROL =
  'rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring';

function UsageControl({
  field,
  value,
  error,
  onChange,
}: {
  field: (typeof USAGE_FIELDS)[number];
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = `pricing-${field.key}`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {field.label}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="number"
            min={field.min}
            max={1_000_000_000}
            step={field.decimals ? 0.01 : 1}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
            className={cn(CONTROL, 'w-32 text-right tabular-nums')}
          />
          <span className="w-14 text-xs text-fg-muted">{field.unit}</span>
        </div>
      </div>
      <input
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={Math.min(field.max, Math.max(field.min, Number(value) || field.min))}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        aria-label={`${field.label} slider`}
        aria-describedby={`${id}-hint`}
        className="block h-6 w-full cursor-pointer accent-current text-signal outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <p id={`${id}-hint`} className="text-xs leading-5 text-fg-muted">
        {field.hint}
      </p>
      {error && (
        <p id={`${id}-error`} className="text-sm text-fg" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function PlanResults({
  estimate,
  selected,
  onSelect,
}: {
  estimate: ReturnType<typeof estimatePricing>;
  selected: SelfServePaidPlanId;
  onSelect: (plan: SelfServePaidPlanId) => void;
}) {
  const bill = estimate.bills[selected];
  const plan = PLAN_CATALOG[selected];
  const grossCents = estimate.breakdown.reduce((sum, row) => sum + row.grossCents, 0);
  return (
    <div className="min-w-0 space-y-6">
      <fieldset>
        <legend className="mb-3 text-sm font-medium">Compare monthly estimates</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {CALCULATOR_PLANS.map((id) => (
            <label
              key={id}
              className={cn(
                'cursor-pointer rounded-lg border p-3 text-sm',
                selected === id ? 'border-signal bg-signal-soft' : 'border-border bg-bg',
              )}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="pricing-plan"
                  aria-label={PLAN_CATALOG[id].name}
                  value={id}
                  checked={selected === id}
                  onChange={() => {
                    onSelect(id);
                  }}
                  className="accent-current focus-visible:ring-2 focus-visible:ring-ring"
                />
                {PLAN_CATALOG[id].name}
              </span>
              <span className="mt-3 block text-xl font-semibold tabular-nums">
                {formatEuroFromCents(estimate.bills[id].totalCents)}
              </span>
              <span className="text-xs text-fg-muted">/month, excl. VAT</span>
              {estimate.cheapest === id && (
                <span className="mt-2 block text-xs font-medium text-signal">
                  Lowest estimated cost
                </span>
              )}
              {estimate.capacityWarnings[id].length > 0 && (
                <span className="mt-2 block text-xs">Exceeds measured capacity</span>
              )}
            </label>
          ))}
        </div>
      </fieldset>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        Monthly estimates:{' '}
        {CALCULATOR_PLANS.map(
          (id) => `${PLAN_CATALOG[id].name} ${formatEuroFromCents(estimate.bills[id].totalCents)}`,
        ).join(', ')}
        . Excluding VAT.
      </p>
      <div className="rounded-lg border border-border bg-bg p-5">
        <h3 className="text-lg font-semibold">{plan.name} breakdown</h3>
        <dl className="mt-4 space-y-3 text-sm">
          <CostRow label="Platform fee" cents={bill.platformFeeCents} />
          <CostRow
            label="Extra members"
            hint={`${plan.includedActiveMembers} members included`}
            cents={bill.extraMemberCents}
          />
          {estimate.breakdown.map((row) => (
            <CostRow
              key={row.id}
              label={row.label}
              hint={selected === 'payg' ? row.allowance : 'Before pooled usage credit'}
              cents={selected === 'payg' ? row.paygCents : row.grossCents}
            />
          ))}
          {selected !== 'payg' && (
            <CostRow
              label="Included usage credit"
              hint={`Up to ${formatEuroFromCents(plan.includedUsageDiscountCents)} across usage`}
              cents={grossCents === 0 ? 0 : -Math.min(grossCents, plan.includedUsageDiscountCents)}
            />
          )}
          <div className="flex justify-between gap-4 border-t border-border pt-4 font-semibold">
            <dt>
              Estimated monthly total
              <span className="block text-xs font-normal text-fg-muted">Excluding VAT</span>
            </dt>
            <dd className="text-xl tabular-nums">{formatEuroFromCents(bill.totalCents)}</dd>
          </div>
        </dl>
        {estimate.capacityWarnings[selected].length > 0 && (
          <p className="mt-4 text-sm">
            This estimate exceeds this plan’s capacity:{' '}
            {estimate.capacityWarnings[selected].join(', ')}. The price is illustrative; this plan
            cannot support all entered usage.
          </p>
        )}
        {estimate.cheapest === null && (
          <p className="mt-4 text-sm">
            Your usage exceeds the measured limits of all self-serve plans.{' '}
            <Link href="/help/support" className="underline">
              Contact sales
            </Link>
            .
          </p>
        )}
      </div>
      <p className="text-xs leading-5 text-fg-muted">
        Estimates assume a full month at standard published prices on one eligible workspace. Actual
        AI charges vary. Other capacity limits apply, including inbound email, agent turns and
        concurrent meetings. Usage may require raising your spend cap; the estimate is not capped.
        Custom terms and prorating are not included.
      </p>
    </div>
  );
}

function CostRow({ label, hint, cents }: { label: string; hint?: string; cents: number }) {
  return (
    <div className="flex justify-between gap-4">
      <dt>
        {label}
        {hint && <span className="block text-xs text-fg-muted">{hint}</span>}
      </dt>
      <dd className="shrink-0 tabular-nums">{formatEuroFromCents(cents)}</dd>
    </div>
  );
}

export function PricingCalculator() {
  const [draft, setDraft] = useState<UsageDraft>(EXAMPLE_USAGE);
  const [selected, setSelected] = useState<SelfServePaidPlanId>('payg');
  const { values, errors } = parseUsage(draft);
  const estimate = values ? estimatePricing(values) : null;
  function update(key: UsageKey, value: string) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }
  return (
    <div className="mt-10" data-pricing-calculator>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          Illustrative example — adjust it to your monthly usage.
        </p>
        <button
          type="button"
          onClick={() => {
            setDraft(EXAMPLE_USAGE);
          }}
          className={cn(CONTROL, 'text-sm hover:bg-surface-2')}
        >
          Reset example
        </button>
      </div>
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="space-y-6">
          {USAGE_FIELDS.filter((field) => field.key !== 'sources').map((field) => (
            <UsageControl
              key={field.key}
              field={field}
              value={draft[field.key]}
              error={errors[field.key]}
              onChange={(value) => {
                update(field.key, value);
              }}
            />
          ))}
          <details className="border-t border-border pt-4">
            <summary className="cursor-pointer text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Advanced usage ·{' '}
              {errors.sources
                ? 'Check accepted sources'
                : `${Number(draft.sources).toLocaleString('en-IE')} accepted sources`}
            </summary>
            <div className="mt-4">
              <UsageControl
                field={USAGE_FIELDS[5]}
                value={draft.sources}
                error={errors.sources}
                onChange={(value) => {
                  update('sources', value);
                }}
              />
            </div>
          </details>
        </div>
        {estimate ? (
          <PlanResults estimate={estimate} selected={selected} onSelect={setSelected} />
        ) : (
          <p role="status" className="rounded-lg border border-border p-5 text-sm">
            Complete all usage fields with valid numbers to see your estimates.
          </p>
        )}
      </div>
    </div>
  );
}
