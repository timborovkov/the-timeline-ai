import {
  CAPACITY_BY_PLAN,
  FREE_ALLOWANCES,
  PLAN_CATALOG,
  acceptedSourcesChargeCents,
  emailChargeCents,
  formatEuroFromCents,
  formatStorageGb,
  recallChargeCents,
  storageChargeCents,
  type BillingMeterId,
} from '@timeline/shared/billing/catalog';
import { cheapestPlanPreview, type SelfServePaidPlanId } from '@timeline/shared/billing/preview';
import { estimateWebsiteUsage } from '@timeline/shared/websites/usage';

export const CALCULATOR_PLANS = ['payg', 'team', 'business'] as const;
/** Exact fields may exceed slider ranges; this is the parse ceiling, not a billed cap. */
export const MAX_USAGE_VALUE = 1_000_000_000;
export const USAGE_FIELDS = [
  {
    key: 'members',
    label: 'Active members',
    unit: 'members',
    min: 1,
    max: 500,
    step: 1,
    decimals: 0,
    hint: 'All members active throughout the month.',
  },
  {
    key: 'ai',
    label: 'Assumed AI usage',
    unit: 'EUR',
    min: 0,
    max: 500,
    step: 1,
    decimals: 2,
    hint: 'Assumed customer AI charges before allowances, including background processing. Actual usage varies by model and workload.',
  },
  {
    key: 'meetings',
    label: 'Meeting hours',
    unit: 'hours',
    min: 0,
    max: 500,
    step: 1,
    decimals: 2,
    hint: 'Total bot/transcription time, including joining and waiting.',
  },
  {
    key: 'email',
    label: 'Email units',
    unit: 'units',
    min: 0,
    max: 50_000,
    step: 500,
    decimals: 0,
    hint: 'Inbound messages plus outbound recipients.',
  },
  {
    key: 'storage',
    label: 'Storage',
    unit: 'GB',
    min: 0,
    max: 250,
    step: 1,
    decimals: 2,
    hint: 'Average original-file storage held throughout the month. 1 GB = 1,024 MB.',
  },
  {
    key: 'sources',
    label: 'Accepted sources',
    unit: 'items',
    min: 0,
    max: 1_000_000,
    step: 1_000,
    decimals: 0,
    hint: 'Ordinary accepted sources use one unit each. Exclude website pages here; the website estimate adds 20 units per crawled page. AI is separate.',
  },
] as const;
export type UsageKey = (typeof USAGE_FIELDS)[number]['key'];
export type UsageDraft = Record<UsageKey, string>;
export type UsageValues = Record<UsageKey, number>;
export const EXAMPLE_USAGE: UsageDraft = {
  members: '5',
  ai: '20',
  meetings: '10',
  email: '1000',
  storage: '1',
  sources: '2000',
};
const sourcesField = USAGE_FIELDS.find((field) => field.key === 'sources');
if (!sourcesField) throw new Error('Accepted sources must remain a calculator field');
export const SOURCES_FIELD = sourcesField;

export function parseUsage(draft: UsageDraft) {
  const values = {} as UsageValues;
  const errors: Partial<Record<UsageKey, string>> = {};
  for (const field of USAGE_FIELDS) {
    const raw = draft[field.key].trim();
    const value = Number(raw);
    const pattern = field.decimals === 0 ? /^\d+$/u : /^\d+(?:\.\d{1,2})?$/u;
    // Keep cent and unit conversions comfortably within safe integer precision.
    if (
      !pattern.test(raw) ||
      !Number.isFinite(value) ||
      value < field.min ||
      value > MAX_USAGE_VALUE
    ) {
      errors[field.key] =
        `Enter ${field.decimals === 0 ? 'a whole number' : 'a number with up to two decimals'} from ${field.min} to ${MAX_USAGE_VALUE.toLocaleString('en-IE')}.`;
    } else values[field.key] = value;
  }
  return { values: Object.keys(errors).length ? null : values, errors };
}

export function estimatePricing(
  usage: UsageValues,
  websiteInput: Parameters<typeof estimateWebsiteUsage>[0] = {
    websites: 0,
    pages: 5,
    frequency: 'manual',
    manualScans: 1,
  },
) {
  const websiteUsage = estimateWebsiteUsage(websiteInput);
  const totalSources = usage.sources + websiteUsage.sourceUnits;
  const rows: {
    id: BillingMeterId;
    label: string;
    nativeUnits: number;
    grossCents: number;
    allowance: string;
  }[] = [
    {
      id: 'ai',
      label: 'AI',
      nativeUnits: Math.round(usage.ai * 100),
      grossCents: Math.round(usage.ai * 100),
      allowance: `${formatEuroFromCents(FREE_ALLOWANCES.aiChargeCents)} included`,
    },
    {
      id: 'recall_minutes',
      label: 'Meetings',
      nativeUnits: usage.meetings * 60,
      grossCents: recallChargeCents(usage.meetings * 60),
      allowance: `${FREE_ALLOWANCES.recallMinutes} minutes included`,
    },
    {
      id: 'email_units',
      label: 'Email',
      nativeUnits: usage.email,
      grossCents: emailChargeCents(usage.email),
      allowance: `${FREE_ALLOWANCES.emailUnits} units included`,
    },
    {
      id: 'storage_gb_month',
      label: 'Storage',
      nativeUnits: usage.storage,
      grossCents: storageChargeCents(usage.storage),
      allowance: `${formatStorageGb(FREE_ALLOWANCES.storageGb)} included`,
    },
    {
      id: 'accepted_sources',
      label: 'Accepted sources',
      nativeUnits: totalSources,
      grossCents: acceptedSourcesChargeCents(totalSources),
      allowance: `${FREE_ALLOWANCES.acceptedSources.toLocaleString('en-IE')} source units included`,
    },
  ];
  const meters = Object.fromEntries(
    rows.map((row) => [
      row.id,
      { nativeUnits: row.nativeUnits, customerChargeCents: row.grossCents },
    ]),
  );
  const preview = cheapestPlanPreview({ activeMembers: usage.members, meters });
  const breakdown = rows.map((row) => ({
    ...row,
    paygCents: cheapestPlanPreview({ activeMembers: 1, meters: { [row.id]: meters[row.id] } }).bills
      .payg.meteredAfterDiscountCents,
  }));
  const capacityWarnings = {} as Record<SelfServePaidPlanId, string[]>;
  let cheapest: SelfServePaidPlanId | null = null;
  for (const id of CALCULATOR_PLANS) {
    const capacity = CAPACITY_BY_PLAN[id];
    const checks = [
      { value: usage.members, limit: PLAN_CATALOG[id].maxActiveMembers, label: 'active members' },
      {
        value: usage.meetings * 60,
        limit: capacity.recallMinutesPerMonth,
        label: 'meeting minutes',
      },
      { value: usage.storage, limit: capacity.storageGb, label: 'GB storage' },
      { value: totalSources, limit: capacity.acceptedSourcesPerMonth, label: 'accepted sources' },
    ];
    capacityWarnings[id] = checks
      .filter((check) => check.limit !== null && check.value > check.limit)
      .map((check) => `${check.limit?.toLocaleString('en-IE')} ${check.label}`);
    // Email units combine inbound and outbound traffic, so they cannot establish
    // whether the separate inbound-email capacity has been exceeded.
    if (
      !capacityWarnings[id].length &&
      (cheapest === null || preview.bills[id].totalCents < preview.bills[cheapest].totalCents)
    )
      cheapest = id;
  }
  return { bills: preview.bills, breakdown, capacityWarnings, cheapest, websiteUsage };
}
