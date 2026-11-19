'use client';

import { PLAN_CATALOG, formatEuroFromCents } from '@timeline/shared/billing/catalog';
import type { SelfServePaidPlanId } from '@timeline/shared/billing/preview';
import Link from 'next/link';
import { useState } from 'react';

import styles from '@/components/marketing/pricing-page.module.css';
import { NativeSelect } from '@/components/ui/native-select';
import { buildEnterpriseEnquiryHref } from '@/lib/enterprise-enquiry';
import {
  CALCULATOR_ACTIVITY_ASSUMPTIONS,
  CALCULATOR_PLANS,
  DEFAULT_USAGE_PRESET,
  MAX_USAGE_VALUE,
  SOURCES_FIELD,
  USAGE_FIELDS,
  USAGE_PRESETS,
  estimatePricing,
  formatUnitAssumption,
  parseUsage,
  presetMatchingDraft,
  type UsageDraft,
  type UsageKey,
  type UsagePreset,
  type UsagePresetId,
  type WebsiteDraft,
} from '@/lib/pricing-calculator';
import { cn } from '@/lib/utils';

const CONTROL =
  'h-11 rounded-sm border border-border bg-surface-2 px-2.5 text-base sm:text-sm text-fg tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring';
const SLIDER =
  'block h-11 w-full cursor-pointer appearance-none bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-slider-runnable-track]:h-0.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-border-strong [&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-signal [&::-moz-range-track]:h-0.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-border-strong [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-signal';
const PRESET_BUTTON =
  'min-h-11 rounded-sm border px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

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
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {field.label}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="number"
            min={field.min}
            max={MAX_USAGE_VALUE}
            step={field.decimals ? 0.01 : 1}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
            className={cn(CONTROL, 'w-[7.25rem] text-right')}
          />
          <span className="w-14 shrink-0 text-xs leading-4 text-fg-muted">{field.unit}</span>
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
        className={SLIDER}
      />
      <p id={`${id}-hint`} className="text-xs leading-4 text-fg-muted">
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
  enterpriseHref,
}: {
  estimate: ReturnType<typeof estimatePricing>;
  selected: SelfServePaidPlanId;
  onSelect: (plan: SelfServePaidPlanId) => void;
  enterpriseHref: string;
}) {
  const bill = estimate.bills[selected];
  const plan = PLAN_CATALOG[selected];
  const grossCents = estimate.breakdown.reduce((sum, row) => sum + row.grossCents, 0);
  return (
    <div className="min-w-0 space-y-4">
      <fieldset>
        <legend className="mb-3 text-sm font-medium">Compare monthly estimates</legend>
        <div className="border border-border bg-bg">
          <div className="grid sm:grid-cols-3 sm:divide-x sm:divide-y-0 divide-y divide-border">
            {CALCULATOR_PLANS.map((id) => (
              <label
                key={id}
                className={cn(
                  'cursor-pointer p-4 text-sm',
                  selected === id ? 'bg-signal-soft' : 'bg-bg',
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
                <span className="mt-2 block text-xl font-semibold tabular-nums">
                  {formatEuroFromCents(estimate.bills[id].totalCents)}
                </span>
                <span className="text-xs leading-4 text-fg-muted">/month, excl. VAT</span>
                {estimate.cheapest === id && (
                  <span className="mt-2 block text-xs font-medium leading-4 text-fg">
                    Lowest estimated cost
                  </span>
                )}
                {estimate.capacityWarnings[id].length > 0 && (
                  <span className="mt-2 block text-xs leading-4">Exceeds measured capacity</span>
                )}
              </label>
            ))}
          </div>
          <div id="pricing-breakdown" className="scroll-mt-40 border-t border-border p-5">
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
                  cents={
                    grossCents === 0 ? 0 : -Math.min(grossCents, plan.includedUsageDiscountCents)
                  }
                />
              )}
              <div className="flex justify-between gap-4 border-t border-border pt-4 font-semibold">
                <dt>
                  Estimated monthly total
                  <span className="block text-xs font-normal leading-4 text-fg-muted">
                    Excluding VAT
                  </span>
                </dt>
                <dd className="text-xl tabular-nums">{formatEuroFromCents(bill.totalCents)}</dd>
              </div>
            </dl>
            {estimate.capacityWarnings[selected].length > 0 && (
              <p className="mt-4 text-sm">
                This estimate exceeds this plan’s capacity:{' '}
                {estimate.capacityWarnings[selected].join(', ')}. The price is illustrative; this
                plan cannot support all entered usage.
              </p>
            )}
            {estimate.cheapest === null && (
              <p className="mt-4 text-sm">
                Your usage exceeds the measured limits of all self-serve plans.{' '}
                <Link
                  href={enterpriseHref}
                  data-public-analytics-cta="contact_enterprise"
                  className="underline"
                >
                  Contact us about Enterprise
                </Link>
                .
              </p>
            )}
          </div>
        </div>
      </fieldset>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        Monthly estimates:{' '}
        {CALCULATOR_PLANS.map(
          (id) => `${PLAN_CATALOG[id].name} ${formatEuroFromCents(estimate.bills[id].totalCents)}`,
        ).join(', ')}
        . Excluding VAT.
      </p>
      <p className="max-w-[75ch] text-sm leading-6 text-fg-muted">
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
        {hint && <span className="block text-xs leading-4 text-fg-muted">{hint}</span>}
      </dt>
      <dd className="shrink-0 tabular-nums">{formatEuroFromCents(cents)}</dd>
    </div>
  );
}

function ExamplePresets({
  matchedPreset,
  onSelect,
  onReset,
}: {
  matchedPreset: UsagePreset | null;
  onSelect: (id: UsagePresetId) => void;
  onReset: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-fg">Example starting points</p>
          <p className="text-sm text-fg-muted">
            Pick an example to fill the fields, then edit anything. These are illustrations, not
            quotes.
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="min-h-11 rounded-sm text-sm text-fg-muted underline decoration-border-strong underline-offset-4 outline-none hover:text-fg hover:decoration-fg focus-visible:ring-2 focus-visible:ring-ring"
        >
          Reset example
        </button>
      </div>
      <div
        role="group"
        aria-label="Example starting points"
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
      >
        {USAGE_PRESETS.map((preset) => {
          const pressed = matchedPreset?.id === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={pressed}
              onClick={() => {
                onSelect(preset.id);
              }}
              className={cn(
                PRESET_BUTTON,
                'sm:max-w-[16rem] sm:flex-1',
                pressed
                  ? 'border-signal bg-signal-soft text-fg'
                  : 'border-border bg-surface-2 text-fg hover:border-border-strong',
              )}
            >
              <span className="block font-medium">{preset.label}</span>
              <span className="mt-1 block text-xs leading-4 text-fg-muted">
                {preset.description}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs leading-5 text-fg-muted">{formatUnitAssumption()}</p>
    </div>
  );
}

function MobileEstimate({
  estimate,
  selected,
}: {
  estimate: ReturnType<typeof estimatePricing> | null;
  selected: SelfServePaidPlanId;
}) {
  if (!estimate) {
    return (
      <div className={styles.mobileEstimate} data-mobile-estimate>
        <p>Check your usage fields to see an estimate.</p>
      </div>
    );
  }
  return (
    <div className={styles.mobileEstimate} data-mobile-estimate>
      <div>
        <p>{PLAN_CATALOG[selected].name} estimate</p>
        <strong>{formatEuroFromCents(estimate.bills[selected].totalCents)}</strong>
        <span className="ml-2 text-sm text-fg-muted">/mo, excl. VAT</span>
      </div>
      <a href="#pricing-breakdown">View breakdown</a>
      {estimate.capacityWarnings[selected].length > 0 ? (
        <p className="basis-full">Exceeds this plan’s capacity. Check the breakdown.</p>
      ) : null}
    </div>
  );
}

function WebsiteScanControls({
  websiteInput,
  websiteUsage,
  onChange,
}: {
  websiteInput: WebsiteDraft;
  websiteUsage: ReturnType<typeof estimatePricing>['websiteUsage'] | null;
  onChange: (next: WebsiteDraft) => void;
}) {
  return (
    <details className="border-t border-border pt-4">
      <summary className="cursor-pointer rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Website scans{' '}
        <span className="font-normal text-fg-muted">
          · {websiteInput.websites === 0 ? 'Optional' : `${websiteInput.websites} websites`}
        </span>
      </summary>
      <fieldset className="mt-4 grid grid-cols-2 gap-3">
        <legend className="sr-only">Website scanning</legend>
        <label className="space-y-1.5 text-sm">
          Websites{' '}
          <input
            className={`${CONTROL} block w-full min-w-0`}
            type="number"
            min={0}
            max={100}
            value={websiteInput.websites}
            onChange={(event) => {
              onChange({
                ...websiteInput,
                websites: Math.min(100, Math.max(0, Math.floor(Number(event.target.value) || 0))),
              });
            }}
          />
        </label>
        <label className="space-y-1.5 text-sm">
          Pages per scan{' '}
          <input
            className={`${CONTROL} block w-full min-w-0`}
            type="number"
            min={1}
            max={5}
            value={websiteInput.pages}
            onChange={(event) => {
              onChange({
                ...websiteInput,
                pages: Math.min(5, Math.max(1, Math.floor(Number(event.target.value) || 1))),
              });
            }}
          />
        </label>
        <label className="space-y-1.5 text-sm">
          Scan frequency{' '}
          <NativeSelect
            className={`${CONTROL} block w-full min-w-0`}
            value={websiteInput.frequency}
            onChange={(event) => {
              onChange({
                ...websiteInput,
                frequency: event.target.value as 'manual' | 'daily' | 'weekly',
              });
            }}
          >
            <option value="manual">Manual</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </NativeSelect>
        </label>
        {websiteInput.frequency === 'manual' ? (
          <label className="space-y-1.5 text-sm">
            Scans / month{' '}
            <input
              className={`${CONTROL} block w-full min-w-0`}
              type="number"
              min={0}
              max={720}
              value={websiteInput.manualScans}
              onChange={(event) => {
                onChange({
                  ...websiteInput,
                  manualScans: Math.min(
                    720,
                    Math.max(0, Math.floor(Number(event.target.value) || 0)),
                  ),
                });
              }}
            />
          </label>
        ) : null}
      </fieldset>
      {websiteUsage && websiteInput.websites > 0 ? (
        <p className="mt-4 text-sm tabular-nums" aria-live="polite">
          {websiteUsage.pages.toLocaleString()} pages / month
          <span className="block text-fg-muted">
            {websiteUsage.sourceUnits.toLocaleString()} source units · included in total
          </span>
        </p>
      ) : null}
      <details className="mt-3 text-xs text-fg-muted">
        <summary className="w-fit cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          How it’s calculated
        </summary>
        <p className="mt-2 leading-5">
          {CALCULATOR_ACTIVITY_ASSUMPTIONS.websitePageSourceUnits} units per captured page, even if
          unchanged. Daily assumes 30 scans/month; weekly assumes 5. AI and storage are separate.
          Schedules are available once enabled for the service.
        </p>
      </details>
    </details>
  );
}

function usePricingCalculatorState() {
  const [websiteInput, setWebsiteInput] = useState<WebsiteDraft>(DEFAULT_USAGE_PRESET.website);
  const [draft, setDraft] = useState<UsageDraft>(DEFAULT_USAGE_PRESET.usage);
  const [selected, setSelected] = useState<SelfServePaidPlanId>('payg');
  const [activePresetId, setActivePresetId] = useState<UsagePresetId | null>(
    DEFAULT_USAGE_PRESET.id,
  );
  const { values, errors } = parseUsage(draft);
  const matchedPreset = activePresetId
    ? (USAGE_PRESETS.find((preset) => preset.id === activePresetId) ?? null)
    : presetMatchingDraft(draft, websiteInput);
  const estimate = values ? estimatePricing(values, websiteInput) : null;
  const enterpriseHref = buildEnterpriseEnquiryHref({
    from: 'pricing-calculator',
    plan: selected,
    members: draft.members,
    ai: draft.ai,
    meetings: draft.meetings,
    email: draft.email,
    storage: draft.storage,
    sources: draft.sources,
    websites: String(websiteInput.websites),
    pages: String(websiteInput.pages),
    frequency: websiteInput.frequency,
    manualScans: String(websiteInput.manualScans),
  });

  function applyPreset(id: UsagePresetId) {
    const preset = USAGE_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setDraft(preset.usage);
    setWebsiteInput(preset.website);
    setSelected('payg');
    setActivePresetId(preset.id);
  }

  function update(key: UsageKey, value: string) {
    setActivePresetId(null);
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  function updateWebsite(next: WebsiteDraft) {
    setActivePresetId(null);
    setWebsiteInput(next);
  }

  return {
    websiteInput,
    draft,
    selected,
    setSelected,
    matchedPreset,
    estimate,
    enterpriseHref,
    errors,
    applyPreset,
    update,
    updateWebsite,
    reset: () => {
      applyPreset(DEFAULT_USAGE_PRESET.id);
    },
  };
}

export function PricingCalculator() {
  const state = usePricingCalculatorState();
  return (
    <div className="mt-10" data-pricing-calculator>
      <div className="mb-6">
        <ExamplePresets
          matchedPreset={state.matchedPreset}
          onSelect={state.applyPreset}
          onReset={state.reset}
        />
      </div>
      <MobileEstimate estimate={state.estimate} selected={state.selected} />
      <div className="grid items-start gap-10 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="space-y-5">
          {USAGE_FIELDS.filter((field) => field.key !== 'sources').map((field) => (
            <UsageControl
              key={field.key}
              field={field}
              value={state.draft[field.key]}
              error={state.errors[field.key]}
              onChange={(value) => {
                state.update(field.key, value);
              }}
            />
          ))}
          <WebsiteScanControls
            websiteInput={state.websiteInput}
            websiteUsage={state.estimate?.websiteUsage ?? null}
            onChange={state.updateWebsite}
          />
          <details className="border-t border-border pt-4">
            <summary className="cursor-pointer text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Advanced usage ·{' '}
              {state.errors.sources
                ? 'Check accepted sources'
                : `${Number(state.draft.sources).toLocaleString('en-IE')} accepted sources`}
            </summary>
            <div className="mt-4">
              <UsageControl
                field={SOURCES_FIELD}
                value={state.draft.sources}
                error={state.errors.sources}
                onChange={(value) => {
                  state.update('sources', value);
                }}
              />
            </div>
          </details>
        </div>
        {state.estimate ? (
          <PlanResults
            estimate={state.estimate}
            selected={state.selected}
            onSelect={state.setSelected}
            enterpriseHref={state.enterpriseHref}
          />
        ) : (
          <p
            role="status"
            aria-live="polite"
            className="border border-border bg-bg p-5 text-sm text-fg"
          >
            Complete all usage fields with valid numbers to see your estimates.
          </p>
        )}
      </div>
    </div>
  );
}
