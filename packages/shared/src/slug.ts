import { randomBytes } from 'node:crypto';

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function randomSlugSuffix(): string {
  return randomBytes(3).toString('hex');
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Compose the per-team inbound email address. `slug` must already be the
 * persisted team slug (uniquely scoped). Returns null when
 * `INBOUND_EMAIL_DOMAIN` isn't set so the caller can decide whether to
 * persist an `inbound.invalid` placeholder or fail loudly — Phase 7 web
 * deployments fail loudly via env-validate at team-create, but tests and
 * local dev without Resend configured fall back to the placeholder.
 */
export function buildInboundEmail(slug: string, inboundDomain: string | undefined): string {
  const domain = (inboundDomain ?? 'inbound.invalid').trim().toLowerCase();
  return `${slug}@${domain}`;
}
