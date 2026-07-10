const EMAIL_IDENTITY_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const PHONE_IDENTITY_RE = /^(?:\+[1-9]\d{6,14}|\d{7,15})$/;

export type ActorKind = 'user' | 'agent' | 'system';

export type IdentityFacetKind =
  | 'email'
  | 'phone'
  | 'telegram'
  | 'slack'
  | 'github'
  | 'timeline_user'
  | 'other';

export interface IdentityFacetInput {
  entityId: string;
  kind: IdentityFacetKind;
  value: string;
  normalizedValue?: string;
  provider?: string | null;
  externalId?: string | null;
  linkedUserId?: string | null;
  source?: 'manual' | 'agent_approved' | 'integration' | 'system';
  metadata?: Record<string, unknown>;
  actor: { kind: ActorKind; userId?: string | null };
}

export interface IdentityFacetRow {
  id: string;
  entityId: string;
  kind: IdentityFacetKind;
  value: string;
  normalizedValue: string;
  provider: string | null;
  externalId: string | null;
  linkedUserId: string | null;
}

export function normalizeIdentityFacet(kind: IdentityFacetKind, value: string): string {
  const trimmed = value.trim();
  if (kind === 'email') return trimmed.toLowerCase();
  if (kind === 'phone') return trimmed.replace(/[^\d+]/g, '');
  if (kind === 'telegram' || kind === 'github') return trimmed.toLowerCase().replace(/^@/, '');
  if (kind === 'slack') return trimmed;
  if (kind === 'timeline_user') return trimmed.toLowerCase();
  return trimmed.toLowerCase();
}

export function validateIdentityFacetValue(kind: IdentityFacetKind, normalizedValue: string): void {
  if (kind === 'email' && !EMAIL_IDENTITY_RE.test(normalizedValue)) {
    throw new Error('Identity facet email must be a valid email address');
  }
  if (kind === 'phone' && !PHONE_IDENTITY_RE.test(normalizedValue)) {
    throw new Error('Identity facet phone must be a valid phone number');
  }
}
