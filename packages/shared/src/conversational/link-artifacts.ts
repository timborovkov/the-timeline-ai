import { artifactClusters, artifactEvidenceAssociations, type Db } from '@timeline/db';
import { and, eq, inArray } from 'drizzle-orm';

import { reconcileArtifactEvidence, type ArtifactAnchorInput } from '#src/artifacts/index.js';

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

const URL_RE = /https?:\/\/[^\s<>"'|]+/gi;
const SLACK_LINK_RE = /<((?:https?:\/\/)[^>|]+)(?:\|([^>]+))?>/gi;
const TRAILING_PUNCTUATION_RE = /[),.;:!?]+$/;
const TRACKING_PARAM_PREFIXES = ['utm_'];
const TRACKING_PARAM_NAMES = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'ref',
  'ref_src',
]);
const SECRET_PARAM_NAMES = new Set([
  'access_token',
  'access_key',
  'access-key',
  'accesstoken',
  'api_key',
  'api-key',
  'apikey',
  'auth',
  'auth_code',
  'auth_token',
  'authcode',
  'authtoken',
  'authorization',
  'client_secret',
  'client-secret',
  'clientsecret',
  'code',
  'code_challenge',
  'code-challenge',
  'code_verifier',
  'code-verifier',
  'id_token',
  'id-token',
  'idtoken',
  'key',
  'oauth_token',
  'oauth-token',
  'oauthtoken',
  'refresh_token',
  'refresh-token',
  'refreshtoken',
  'secret',
  'secret_key',
  'secret-key',
  'sig',
  'signature',
  'token',
  'x_api_key',
  'x-api-key',
]);
const SECRET_PARAM_PARTS = new Set(['auth', 'secret', 'sig', 'signature', 'token']);
const SECRET_PARAM_PART_SEQUENCES = [
  ['access', 'key'],
  ['api', 'key'],
  ['client', 'secret'],
  ['code', 'challenge'],
  ['code', 'verifier'],
  ['oauth', 'token'],
  ['refresh', 'token'],
] as const;

export interface CapturedLink {
  rawUrl: string;
  canonicalUrl: string;
  displayUrl: string;
  domain: string;
  label: string | null;
  provider: string | null;
  providerObjectId: string | null;
}

export interface LinkArtifactMetadata {
  canonical_url: string;
  display_url: string;
  domain: string;
  label: string | null;
  provider: string | null;
  provider_object_id: string | null;
}

function stripTrailingPunctuation(value: string): string {
  let out = value.trim();
  while (TRAILING_PUNCTUATION_RE.test(out)) out = out.replace(TRAILING_PUNCTUATION_RE, '');
  return out;
}

function shouldDropParam(name: string): boolean {
  const lower = name.toLowerCase();
  const parts = lower.split(/[^a-z0-9]+/).filter(Boolean);
  return (
    TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix)) ||
    TRACKING_PARAM_NAMES.has(lower) ||
    SECRET_PARAM_NAMES.has(lower) ||
    parts.some((part) => SECRET_PARAM_PARTS.has(part)) ||
    SECRET_PARAM_PART_SEQUENCES.some((sequence) =>
      parts.some((_, index) =>
        sequence.every((expected, offset) => parts[index + offset] === expected),
      ),
    )
  );
}

function normalizeUrl(raw: string): URL | null {
  try {
    const url = new URL(stripTrailingPunctuation(raw));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.username = '';
    url.password = '';
    url.hash = '';
    if (
      (url.protocol === 'https:' && url.port === '443') ||
      (url.protocol === 'http:' && url.port === '80')
    ) {
      url.port = '';
    }
    for (const name of [...url.searchParams.keys()]) {
      if (shouldDropParam(name)) url.searchParams.delete(name);
    }
    const sortedParams = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    url.search = '';
    for (const [name, value] of sortedParams) url.searchParams.append(name, value);
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url;
  } catch {
    return null;
  }
}

function displayUrlFor(url: URL): string {
  const path = url.pathname === '/' ? '' : url.pathname;
  return `${url.hostname}${path}`;
}

function githubObjectId(url: URL): string | null {
  if (url.hostname !== 'github.com') return null;
  const [owner, repo, kind, id] = url.pathname.split('/').filter(Boolean);
  if (!owner || !repo || !kind || !id) return null;
  if (kind === 'pull') return `${owner}/${repo}#${id}`;
  if (kind === 'issues') return `${owner}/${repo}#issue:${id}`;
  if (kind === 'commit') return `${owner}/${repo}#commit:${id}`;
  return null;
}

function providerFor(url: URL): { provider: string | null; providerObjectId: string | null } {
  const github = githubObjectId(url);
  if (github) return { provider: 'github', providerObjectId: github };
  if (url.hostname === 'linear.app') return { provider: 'linear', providerObjectId: null };
  if (url.hostname.endsWith('.sentry.io')) return { provider: 'sentry', providerObjectId: null };
  if (url.hostname === 'drive.google.com' || url.hostname === 'docs.google.com') {
    return { provider: 'google_drive', providerObjectId: null };
  }
  if (url.hostname === 'slack.com' || url.hostname.endsWith('.slack.com')) {
    return { provider: 'slack', providerObjectId: null };
  }
  return { provider: null, providerObjectId: null };
}

function capturedLink(rawUrl: string, label: string | null): CapturedLink | null {
  const url = normalizeUrl(rawUrl);
  if (!url) return null;
  const { provider, providerObjectId } = providerFor(url);
  const trimmedLabel = label?.trim();
  return {
    rawUrl: stripTrailingPunctuation(rawUrl),
    canonicalUrl: url.toString(),
    displayUrl: displayUrlFor(url),
    domain: url.hostname,
    label: trimmedLabel ?? null,
    provider,
    providerObjectId,
  };
}

export function extractLinksFromText(text: string | null | undefined): CapturedLink[] {
  if (!text) return [];
  const byCanonicalUrl = new Map<string, CapturedLink>();

  for (const match of text.matchAll(SLACK_LINK_RE)) {
    const link = capturedLink(match[1] ?? '', match[2] ?? null);
    if (link) byCanonicalUrl.set(link.canonicalUrl, link);
  }

  for (const match of text.matchAll(URL_RE)) {
    const link = capturedLink(match[0], null);
    if (!link || byCanonicalUrl.has(link.canonicalUrl)) continue;
    byCanonicalUrl.set(link.canonicalUrl, link);
  }

  return [...byCanonicalUrl.values()];
}

export function linkMetadata(links: CapturedLink[]): LinkArtifactMetadata[] {
  return links.map((link) => ({
    canonical_url: link.canonicalUrl,
    display_url: link.displayUrl,
    domain: link.domain,
    label: link.label,
    provider: link.provider,
    provider_object_id: link.providerObjectId,
  }));
}

export function sourceMetadataWithLinks(
  metadata: Record<string, unknown>,
  text: string | null | undefined,
): Record<string, unknown> {
  const links = extractLinksFromText(text);
  if (links.length === 0) return metadata;
  return { ...metadata, links: linkMetadata(links) };
}

export function textHasLinks(text: string | null | undefined): boolean {
  return extractLinksFromText(text).length > 0;
}

function canonicalNameForLink(link: CapturedLink): string {
  const label = link.label && !/^https?:\/\//i.test(link.label) ? link.label : null;
  return label ? `${label} (${link.displayUrl})` : link.displayUrl;
}

function anchorsForLink(link: CapturedLink): ArtifactAnchorInput[] {
  const anchors: ArtifactAnchorInput[] = [
    { type: 'url:canonical', value: link.canonicalUrl, strength: 'hard' },
    { type: 'url:display', value: link.displayUrl, strength: 'semantic' },
  ];
  if (link.provider && link.providerObjectId) {
    anchors.push({
      type: `provider_external:${link.provider}`,
      value: link.providerObjectId,
      strength: 'hard',
    });
  }
  return anchors;
}

export async function reconcileLinkArtifactsForRawEvent(
  db: DbOrTx,
  input: {
    teamId: string;
    rawEventId: string;
    text: string | null | undefined;
    occurredAt?: Date | null;
  },
): Promise<void> {
  const links = extractLinksFromText(input.text);
  for (const link of links) {
    await reconcileArtifactEvidence(db as Db, {
      teamId: input.teamId,
      artifactType: 'link',
      canonicalName: canonicalNameForLink(link),
      status: 'open',
      rawEventId: input.rawEventId,
      occurredAt: input.occurredAt ?? null,
      provider: link.provider,
      externalObjectId: link.providerObjectId,
      role: 'related_context',
      strength: link.providerObjectId ? 'structured' : 'semantic',
      authoritative: false,
      anchors: anchorsForLink(link),
      metadata: {
        source_kind: 'shared_link',
        canonical_url: link.canonicalUrl,
        display_url: link.displayUrl,
        domain: link.domain,
        label: link.label,
        provider: link.provider,
        provider_object_id: link.providerObjectId,
      },
    });
  }
}

export async function refreshLinkArtifactsForRawEvent(
  db: DbOrTx,
  input: Parameters<typeof reconcileLinkArtifactsForRawEvent>[1],
): Promise<void> {
  const linkClusterIds = db
    .select({ id: artifactClusters.id })
    .from(artifactClusters)
    .where(
      and(eq(artifactClusters.teamId, input.teamId), eq(artifactClusters.artifactType, 'link')),
    );
  await db
    .delete(artifactEvidenceAssociations)
    .where(
      and(
        eq(artifactEvidenceAssociations.teamId, input.teamId),
        eq(artifactEvidenceAssociations.rawEventId, input.rawEventId),
        inArray(artifactEvidenceAssociations.clusterId, linkClusterIds),
      ),
    );
  await reconcileLinkArtifactsForRawEvent(db, input);
}
