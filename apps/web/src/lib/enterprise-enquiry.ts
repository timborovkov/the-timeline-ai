/** Dedicated Enterprise enquiry form — separate from general `/help/support`. */

export const ENTERPRISE_ENQUIRY_PATH = '/contact/enterprise';

export const ENTERPRISE_TEAM_SIZES = [
  { value: '1_10', label: '1–10' },
  { value: '11_50', label: '11–50' },
  { value: '51_200', label: '51–200' },
  { value: '201_1000', label: '201–1,000' },
  { value: '1000_plus', label: '1,000+' },
] as const;

export const ENTERPRISE_TOPICS = [
  { value: 'procurement', label: 'Procurement' },
  { value: 'security_review', label: 'Security review' },
  { value: 'sso', label: 'SSO' },
  { value: 'sla', label: 'SLA' },
  { value: 'data_residency', label: 'Data residency' },
  { value: 'on_premise_deployment', label: 'On-premise deployment' },
  { value: 'other', label: 'Other' },
] as const;

export type EnterpriseTeamSize = (typeof ENTERPRISE_TEAM_SIZES)[number]['value'];
export type EnterpriseTopic = (typeof ENTERPRISE_TOPICS)[number]['value'];

export const ENTERPRISE_RESPONSE_EXPECTATION = 'We reply within two business days.';

const TOPIC_VALUES = new Set<string>(ENTERPRISE_TOPICS.map((option) => option.value));

const PRICING_CONTEXT_KEYS = [
  'plan',
  'from',
  'members',
  'ai',
  'meetings',
  'email',
  'storage',
  'sources',
  'websites',
  'pages',
  'frequency',
  'manualScans',
] as const;

export interface EnterpriseEnquiryPrefill {
  plan?: string;
  from?: string;
  members?: string;
  ai?: string;
  meetings?: string;
  email?: string;
  storage?: string;
  sources?: string;
  websites?: string;
  pages?: string;
  frequency?: string;
  manualScans?: string;
  /** Comma-separated topic values from the referring CTA. */
  topics?: string;
}

export interface BuildEnterpriseEnquiryHrefInput extends EnterpriseEnquiryPrefill {
  selectedTopics?: readonly EnterpriseTopic[];
}

function boundedParam(value: string | null | undefined, max = 64): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) return trimmed.slice(0, max);
  if (!/^[\w.+@/: -]+$/u.test(trimmed)) return undefined;
  return trimmed;
}

function readParam(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
  key: string,
  max = 64,
): string | undefined {
  if (params instanceof URLSearchParams) return boundedParam(params.get(key), max);
  const raw = params[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return boundedParam(value, max);
}

export function parseEnterpriseEnquiryPrefill(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): EnterpriseEnquiryPrefill {
  const prefill: EnterpriseEnquiryPrefill = {};
  for (const key of PRICING_CONTEXT_KEYS) {
    const value = readParam(params, key);
    if (value) prefill[key] = value;
  }
  const topics = readParam(params, 'topics', 200);
  if (topics) prefill.topics = topics;
  return prefill;
}

export function parseEnterpriseTopicPrefill(
  params:
    URLSearchParams | Record<string, string | string[] | undefined> | EnterpriseEnquiryPrefill,
): EnterpriseTopic[] {
  const raw =
    'topics' in params && typeof params.topics === 'string'
      ? params.topics
      : readParam(
          params as URLSearchParams | Record<string, string | string[] | undefined>,
          'topics',
        );
  if (!raw) return [];
  const selected = new Set<EnterpriseTopic>();
  for (const part of raw.split(',')) {
    const value = part.trim();
    if (!TOPIC_VALUES.has(value)) continue;
    selected.add(value as EnterpriseTopic);
  }
  return [...selected];
}

export function formatEnterprisePricingContext(prefill: EnterpriseEnquiryPrefill): string | null {
  const parts: string[] = [];
  for (const key of PRICING_CONTEXT_KEYS) {
    const value = prefill[key];
    if (value) parts.push(`${key}=${value}`);
  }
  if (prefill.topics) parts.push(`topics=${prefill.topics}`);
  return parts.length > 0 ? parts.join(', ') : null;
}

export function buildEnterpriseEnquiryHref(input: BuildEnterpriseEnquiryHrefInput = {}): string {
  const { selectedTopics, ...prefill } = input;
  const params = new URLSearchParams();
  for (const key of PRICING_CONTEXT_KEYS) {
    const value = prefill[key]?.trim();
    if (value) params.set(key, value);
  }
  const topics =
    selectedTopics && selectedTopics.length > 0
      ? selectedTopics
      : parseEnterpriseTopicPrefill(prefill);
  if (topics.length > 0) params.set('topics', topics.join(','));
  const query = params.toString();
  return query ? `${ENTERPRISE_ENQUIRY_PATH}?${query}` : ENTERPRISE_ENQUIRY_PATH;
}

export function enterpriseTeamSizeLabel(value: EnterpriseTeamSize): string {
  return ENTERPRISE_TEAM_SIZES.find((option) => option.value === value)?.label ?? value;
}

export function enterpriseTopicLabel(value: EnterpriseTopic): string {
  return ENTERPRISE_TOPICS.find((option) => option.value === value)?.label ?? value;
}
