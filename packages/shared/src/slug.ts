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
 * local dev without Postmark configured fall back to the placeholder.
 */
export function buildInboundEmail(slug: string, inboundDomain: string | undefined): string {
  const domain = (inboundDomain ?? 'inbound.invalid').trim().toLowerCase();
  return `${slug}@${domain}`;
}

/**
 * Compose the user-facing Postmark mailbox-hash address. Used in dev mode
 * (or before the team owns an MX domain): the Postmark server is assigned
 * a fixed address like `<hex>@inbound.postmarkapp.com`; plus-addressing
 * lets us reuse it across teams.
 *
 *   `<hex>+<slug>@inbound.postmarkapp.com`
 *
 * Postmark parses everything after `+` into the inbound payload's
 * `MailboxHash` field, which the dispatcher uses to look up the team by
 * slug. Returns null when `postmarkInboundAddress` is malformed so the
 * caller can fall through to the domain-mode address.
 */
export function composePostmarkHashAddress(
  slug: string,
  postmarkInboundAddress: string | undefined,
): string | null {
  if (!postmarkInboundAddress) return null;
  const at = postmarkInboundAddress.indexOf('@');
  if (at <= 0 || at === postmarkInboundAddress.length - 1) return null;
  const local = postmarkInboundAddress.slice(0, at);
  const domain = postmarkInboundAddress.slice(at + 1);
  return `${local}+${slug}@${domain}`;
}
