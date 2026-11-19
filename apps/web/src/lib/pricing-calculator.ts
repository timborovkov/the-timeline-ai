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
import {
  WEBSITE_SOURCE_UNITS_PER_PAGE,
  estimateWebsiteUsage,
} from '@timeline/shared/websites/usage';

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

export interface WebsiteDraft {
  websites: number;
  pages: number;
  frequency: 'manual' | 'daily' | 'weekly';
  manualScans: number;
}

const DEFAULT_WEBSITE_INPUT: WebsiteDraft = {
  websites: 0,
  pages: 5,
  frequency: 'manual',
  manualScans: 1,
};

function freeAskTurnsPerMonth(): number {
  const turns = CAPACITY_BY_PLAN.free.agentTurnsPerMonth;
  if (turns === null || turns <= 0) {
    throw new Error('Free Ask-turn capacity is required for calculator activity translations');
  }
  return turns;
}

const FREE_ASK_TURNS = freeAskTurnsPerMonth();

/**
 * Catalog-backed rates for translating meters into readable activities.
 * Values come from billing/website contracts — not invented marketing numbers.
 */
export const CALCULATOR_ACTIVITY_ASSUMPTIONS = {
  /** Ordinary accepted sources use one unit each (accepted_sources meter). */
  ordinaryAcceptedSourceUnits: 1,
  /** Website crawling uses the shared per-page multiplier. */
  websitePageSourceUnits: WEBSITE_SOURCE_UNITS_PER_PAGE,
  /**
   * Illustrative customer AI charge per Ask turn: Free AI allowance ÷ Free
   * Ask-turn capacity (`FREE_ALLOWANCES.aiChargeCents` /
   * `CAPACITY_BY_PLAN.free.agentTurnsPerMonth`).
   */
  illustrativeAskTurnCustomerCents: FREE_ALLOWANCES.aiChargeCents / FREE_ASK_TURNS,
  /** Email meter: one unit per inbound message or outbound recipient. */
  emailUnitPerMessageOrRecipient: 1,
} as const;

export interface SourceActivityMix {
  messages: number;
  emails: number;
  documents: number;
  notes: number;
}

export type UsagePresetId = 'client-delivery' | 'slack-engineering' | 'meeting-delivery';

export interface UsagePreset {
  id: UsagePresetId;
  /** Short example label shown on the preset control. */
  label: string;
  /** How the team works — not a quote or offer. */
  description: string;
  usage: UsageDraft;
  website: WebsiteDraft;
  /**
   * Illustrative ordinary-source mix for the preset. Each item costs
   * `ordinaryAcceptedSourceUnits` and the counts must sum to `usage.sources`.
   */
  sourceMix: SourceActivityMix;
}

export const EXAMPLE_USAGE: UsageDraft = {
  members: '5',
  ai: '20',
  meetings: '10',
  email: '1000',
  storage: '1',
  sources: '2000',
};

export const DEFAULT_USAGE_PRESET: UsagePreset = {
  id: 'client-delivery',
  label: 'Five-person client team',
  description: 'Client delivery across shared email, documents, and a handful of calls.',
  usage: EXAMPLE_USAGE,
  website: DEFAULT_WEBSITE_INPUT,
  sourceMix: { messages: 800, emails: 600, documents: 400, notes: 200 },
};

export const USAGE_PRESETS: readonly UsagePreset[] = [
  DEFAULT_USAGE_PRESET,
  {
    id: 'slack-engineering',
    label: 'Slack-heavy engineering team',
    description: 'Busy Slack channels, pull-request notes, and frequent Ask questions.',
    usage: {
      members: '12',
      ai: '45',
      meetings: '8',
      email: '1500',
      storage: '5',
      sources: '25000',
    },
    website: DEFAULT_WEBSITE_INPUT,
    sourceMix: { messages: 22_000, emails: 500, documents: 2_000, notes: 500 },
  },
  {
    id: 'meeting-delivery',
    label: 'Meeting-heavy delivery team',
    description: 'Lots of transcribed calls with lighter chat and a weekly site check.',
    usage: {
      members: '8',
      ai: '35',
      meetings: '40',
      email: '2500',
      storage: '3',
      sources: '6000',
    },
    website: { websites: 1, pages: 5, frequency: 'weekly', manualScans: 1 },
    sourceMix: { messages: 2_500, emails: 1_500, documents: 1_500, notes: 500 },
  },
];

for (const preset of USAGE_PRESETS) {
  const mixTotal =
    preset.sourceMix.messages +
    preset.sourceMix.emails +
    preset.sourceMix.documents +
    preset.sourceMix.notes;
  const sources = Number(preset.usage.sources);
  if (mixTotal !== sources) {
    throw new Error(`Preset ${preset.id} source mix (${mixTotal}) must equal sources (${sources})`);
  }
}

const sourcesField = USAGE_FIELDS.find((field) => field.key === 'sources');
if (!sourcesField) throw new Error('Accepted sources must remain a calculator field');
export const SOURCES_FIELD = sourcesField;

export interface UsageActivities {
  askQuestions: number;
  askCentsPerQuestion: number;
  ordinarySources: number;
  emailMessageOrRecipientUnits: number;
  websitePages: number;
  websiteSourceUnits: number;
  meetingHours: number;
  sourceMix: SourceActivityMix | null;
}

export function translateUsageActivities(
  usage: UsageValues,
  websiteInput: WebsiteDraft = DEFAULT_WEBSITE_INPUT,
  sourceMix: SourceActivityMix | null = null,
): UsageActivities {
  const website = estimateWebsiteUsage(websiteInput);
  const askCents = CALCULATOR_ACTIVITY_ASSUMPTIONS.illustrativeAskTurnCustomerCents;
  return {
    askQuestions: askCents > 0 ? Math.round((usage.ai * 100) / askCents) : 0,
    askCentsPerQuestion: askCents,
    ordinarySources: usage.sources / CALCULATOR_ACTIVITY_ASSUMPTIONS.ordinaryAcceptedSourceUnits,
    emailMessageOrRecipientUnits:
      usage.email / CALCULATOR_ACTIVITY_ASSUMPTIONS.emailUnitPerMessageOrRecipient,
    websitePages: website.pages,
    websiteSourceUnits: website.sourceUnits,
    meetingHours: usage.meetings,
    sourceMix,
  };
}

export function formatAskAssumption(): string {
  const cents = CALCULATOR_ACTIVITY_ASSUMPTIONS.illustrativeAskTurnCustomerCents;
  const euros = cents / 100;
  return `${formatEuroFromCents(FREE_ALLOWANCES.aiChargeCents)} Free AI ÷ ${FREE_ASK_TURNS.toLocaleString('en-IE')} Free Ask turns ≈ ${formatEuroFromCents(Math.round(euros * 100))}/question`;
}

export function formatSourceUnitAssumption(): string {
  return `Ordinary accepted sources use ${CALCULATOR_ACTIVITY_ASSUMPTIONS.ordinaryAcceptedSourceUnits} unit each; website pages use ${CALCULATOR_ACTIVITY_ASSUMPTIONS.websitePageSourceUnits} units each`;
}

export function presetMatchingDraft(draft: UsageDraft, website: WebsiteDraft): UsagePreset | null {
  return (
    USAGE_PRESETS.find(
      (preset) =>
        USAGE_FIELDS.every((field) => preset.usage[field.key] === draft[field.key]) &&
        preset.website.websites === website.websites &&
        preset.website.pages === website.pages &&
        preset.website.frequency === website.frequency &&
        preset.website.manualScans === website.manualScans,
    ) ?? null
  );
}

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
