/** Shared conservative identity rules. Similarity retrieves candidates; it is not identity. */
export interface IdentityObject {
  id: string;
  type: string;
  canonicalName: string;
  aliases?: unknown;
  metadata?: unknown;
}
export type IdentityResolution =
  | {
      kind: 'existing';
      objectId: string;
      reason: string;
      citations?: { rawEventId: string; quote: string }[];
    }
  | { kind: 'ambiguous'; candidateIds: string[]; reason: string }
  | { kind: 'new'; reason: string };

export const IDENTITY_POLICY_VERSION = 'identity-2026-11-v1';
export function identityMetadata(object: IdentityObject): Record<string, unknown> {
  return object.metadata && typeof object.metadata === 'object' && !Array.isArray(object.metadata)
    ? (object.metadata as Record<string, unknown>)
    : {};
}
export function normalizeIdentityName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
function names(object: IdentityObject): string[] {
  return [
    object.canonicalName,
    ...(Array.isArray(object.aliases)
      ? object.aliases.filter((a): a is string => typeof a === 'string')
      : []),
  ]
    .map((value) => {
      const normalized = normalizeIdentityName(value);
      return ['company', 'vendor'].includes(object.type)
        ? normalized
            .replace(/\b(inc|llc|ltd|oy|corp|corporation|company|co|gmbh|plc)\b/g, '')
            .replace(/\s+/g, '')
        : normalized;
    })
    .filter(Boolean);
}
function text(meta: Record<string, unknown>, key: string): string | null {
  return typeof meta[key] === 'string' && meta[key].trim() ? meta[key].trim().toLowerCase() : null;
}
export function identitiesConflict(left: IdentityObject, right: IdentityObject): boolean {
  if (
    left.type !== right.type &&
    !(['company', 'vendor'].includes(left.type) && ['company', 'vendor'].includes(right.type))
  )
    return true;
  const a = identityMetadata(left),
    b = identityMetadata(right);
  for (const key of [
    'companyId',
    'company_id',
    'parentObjectId',
    'repository',
    'repository_full_name',
    'domain',
  ]) {
    if (text(a, key) && text(b, key) && text(a, key) !== text(b, key)) return true;
  }
  const providerA = text(a, 'integration_provider'),
    providerB = text(b, 'integration_provider');
  const externalA = text(a, 'integration_external_id'),
    externalB = text(b, 'integration_external_id');
  return Boolean(
    providerA &&
    providerB &&
    externalA &&
    externalB &&
    (providerA !== providerB || externalA !== externalB),
  );
}
export function identityMatchReason(left: IdentityObject, right: IdentityObject): string | null {
  if (identitiesConflict(left, right)) return null;
  const a = identityMetadata(left),
    b = identityMetadata(right);
  if (
    text(a, 'integration_provider') &&
    text(a, 'integration_provider') === text(b, 'integration_provider') &&
    text(a, 'integration_external_id') &&
    text(a, 'integration_external_id') === text(b, 'integration_external_id')
  )
    return 'provider_identity';
  // A provider-managed record cannot be consumed by an unqualified title match.
  if (text(a, 'integration_external_id') || text(b, 'integration_external_id')) return null;
  const rightNames = names(right);
  return names(left).some((name) => rightNames.includes(name)) ? 'name_or_approved_alias' : null;
}
export function resolveObjectIdentity(
  subject: IdentityObject,
  candidates: readonly IdentityObject[],
): IdentityResolution {
  const matches = candidates.filter(
    (candidate) => candidate.id !== subject.id && identityMatchReason(subject, candidate),
  );
  const onlyMatch = matches[0];
  if (matches.length === 1 && onlyMatch)
    return {
      kind: 'existing',
      objectId: onlyMatch.id,
      reason: identityMatchReason(subject, onlyMatch) ?? 'supported_identity',
    };
  if (matches.length > 1)
    return {
      kind: 'ambiguous',
      candidateIds: matches.map((row) => row.id),
      reason: 'multiple_supported_identities',
    };
  return { kind: 'new', reason: 'no_supported_identity' };
}

const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'yahoo.co.uk',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'mail.com',
  'gmx.com',
  'gmx.de',
  'yandex.com',
  'qq.com',
  '163.com',
  'hey.com',
  'fastmail.com',
  'zoho.com',
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'tempmail.com',
  'example.com',
  'example.org',
  'example.net',
]);
export function businessEmailDomain(email: string): string | null {
  const match = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(email.trim().toLowerCase());
  const domain = match?.[1];
  return domain && !PUBLIC_EMAIL_DOMAINS.has(domain) ? domain : null;
}
function companyDomain(object: IdentityObject): string | null {
  const meta = identityMetadata(object);
  const raw = text(meta, 'domain') ?? text(meta, 'website');
  if (!raw) return null;
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
export function resolveCompanyAffiliation(
  emails: readonly string[],
  companies: readonly IdentityObject[],
): IdentityResolution {
  const domains = new Set(emails.map(businessEmailDomain).filter(Boolean));
  const matches = companies.filter(
    (company) => company.type === 'company' && domains.has(companyDomain(company)),
  );
  const onlyMatch = matches[0];
  if (matches.length === 1 && onlyMatch)
    return { kind: 'existing', objectId: onlyMatch.id, reason: 'business_email_domain' };
  if (matches.length > 1)
    return {
      kind: 'ambiguous',
      candidateIds: matches.map((row) => row.id),
      reason: 'conflicting_company_domains',
    };
  return { kind: 'new', reason: 'no_evidenced_company_domain' };
}
