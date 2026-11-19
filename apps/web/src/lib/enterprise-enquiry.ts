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
  { value: 'other', label: 'Other' },
] as const;

export type EnterpriseTeamSize = (typeof ENTERPRISE_TEAM_SIZES)[number]['value'];
export type EnterpriseTopic = (typeof ENTERPRISE_TOPICS)[number]['value'];

export const ENTERPRISE_RESPONSE_EXPECTATION = 'We reply within two business days.';

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

type EnterprisePricingContextKey = (typeof PRICING_CONTEXT_KEYS)[number];

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
}

function boundedParam(value: string | null | undefined, max = 64): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) return trimmed.slice(0, max);
  if (!/^[\w.+@/: -]+$/u.test(trimmed)) return undefined;
  return trimmed;
}

export function parseEnterpriseEnquiryPrefill(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): EnterpriseEnquiryPrefill {
  const read = (key: EnterprisePricingContextKey): string | undefined => {
    if (params instanceof URLSearchParams) return boundedParam(params.get(key));
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return boundedParam(value);
  };

  const prefill: EnterpriseEnquiryPrefill = {};
  for (const key of PRICING_CONTEXT_KEYS) {
    const value = read(key);
    if (value) prefill[key] = value;
  }
  return prefill;
}

export function formatEnterprisePricingContext(prefill: EnterpriseEnquiryPrefill): string | null {
  const parts: string[] = [];
  for (const key of PRICING_CONTEXT_KEYS) {
    const value = prefill[key];
    if (value) parts.push(`${key}=${value}`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

export function buildEnterpriseEnquiryHref(prefill: EnterpriseEnquiryPrefill = {}): string {
  const params = new URLSearchParams();
  for (const key of PRICING_CONTEXT_KEYS) {
    const value = prefill[key]?.trim();
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${ENTERPRISE_ENQUIRY_PATH}?${query}` : ENTERPRISE_ENQUIRY_PATH;
}

export function enterpriseTeamSizeLabel(value: EnterpriseTeamSize): string {
  return ENTERPRISE_TEAM_SIZES.find((option) => option.value === value)?.label ?? value;
}

export function enterpriseTopicLabel(value: EnterpriseTopic): string {
  return ENTERPRISE_TOPICS.find((option) => option.value === value)?.label ?? value;
}
