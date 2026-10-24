import { createHash, timingSafeEqual } from 'node:crypto';

import {
  TIMELINE_AI_PRIVACY_POLICY_VERSION,
  timelineModelEntries,
  type TimelineModelConfig,
} from '#src/llm/models.js';

export const OPENROUTER_PRIVACY_ATTESTATION_FORMAT = 'orpa1' as const;
export const OPENROUTER_MODEL_CATALOG_FORMAT = 'timeline-openrouter-model-catalog.v1' as const;

export interface OpenRouterModelCatalogAttestationEntry {
  role: string;
  id: string;
  privacyMode: TimelineModelConfig['privacyMode'];
  capabilities: readonly string[];
  limits: {
    contextWindowTokens: number | null;
    embeddingDimensions: number | null;
  };
}

export interface OpenRouterPrivacyAttestationPayload {
  format: typeof OPENROUTER_PRIVACY_ATTESTATION_FORMAT;
  policyVersion: typeof TIMELINE_AI_PRIVACY_POLICY_VERSION;
  catalogSha256: string;
  inferenceKeyFingerprintSha256: string;
  guardrailId: string;
}

type ModelCatalogEntry = readonly [string, TimelineModelConfig];

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function canonicalOpenRouterModelCatalog(
  entries: readonly ModelCatalogEntry[] = timelineModelEntries(),
): readonly OpenRouterModelCatalogAttestationEntry[] {
  return [...entries]
    .sort(([roleA], [roleB]) => compareStrings(roleA, roleB))
    .map(([role, model]) => ({
      role,
      id: model.id,
      privacyMode: model.privacyMode,
      capabilities: [...model.capabilities].sort(),
      limits: {
        contextWindowTokens: model.contextWindowTokens ?? null,
        embeddingDimensions: model.embeddingDimensions ?? null,
      },
    }));
}

export function computeOpenRouterModelCatalogSha256(
  entries: readonly ModelCatalogEntry[] = timelineModelEntries(),
): string {
  return sha256(
    JSON.stringify({
      format: OPENROUTER_MODEL_CATALOG_FORMAT,
      models: canonicalOpenRouterModelCatalog(entries),
    }),
  );
}

/**
 * Changes whenever a role, exact model id, privacy class, capability, or
 * declared model limit changes. This is generated from the code-owned catalog,
 * not maintained by hand.
 */
export const OPENROUTER_MODEL_CATALOG_SHA256 = computeOpenRouterModelCatalogSha256();

/**
 * Returns a non-secret identifier for the high-entropy inference key. It is a
 * local SHA-256 fingerprint, not OpenRouter's management-API `key_hash`; never
 * infer provider-side assignment from this value alone.
 */
export function fingerprintOpenRouterInferenceKey(apiKey: string): string {
  if (apiKey.length === 0 || apiKey.trim() !== apiKey) {
    throw new Error(
      'The OpenRouter inference key must be non-empty with no surrounding whitespace',
    );
  }
  return sha256(apiKey);
}

export function isValidOpenRouterGuardrailId(guardrailId: string): boolean {
  return (
    guardrailId.length > 0 &&
    guardrailId.length <= 256 &&
    guardrailId.trim() === guardrailId &&
    !/[\u0000-\u001f\u007f]/u.test(guardrailId)
  );
}

function assertValidOpenRouterGuardrailId(guardrailId: string): void {
  if (!isValidOpenRouterGuardrailId(guardrailId)) {
    throw new Error(
      'The OpenRouter guardrail id must be a non-empty opaque id without surrounding whitespace or control characters',
    );
  }
}

export function buildOpenRouterPrivacyAttestationPayload(input: {
  apiKey: string;
  guardrailId: string;
}): OpenRouterPrivacyAttestationPayload {
  assertValidOpenRouterGuardrailId(input.guardrailId);
  return {
    format: OPENROUTER_PRIVACY_ATTESTATION_FORMAT,
    policyVersion: TIMELINE_AI_PRIVACY_POLICY_VERSION,
    catalogSha256: OPENROUTER_MODEL_CATALOG_SHA256,
    inferenceKeyFingerprintSha256: fingerprintOpenRouterInferenceKey(input.apiKey),
    guardrailId: input.guardrailId,
  };
}

/**
 * Builds the non-secret production drift token. This binds local deployment
 * intent only: actual key assignment, allowed models, and guardrail settings
 * still require a separate management-key canary and dated deployment evidence.
 * A management key must never be placed in web or worker runtime environments.
 */
export function buildOpenRouterPrivacyAttestationToken(input: {
  apiKey: string;
  guardrailId: string;
}): string {
  const payloadJson = JSON.stringify(buildOpenRouterPrivacyAttestationPayload(input));
  const encodedPayload = Buffer.from(payloadJson, 'utf8').toString('base64url');
  return `${OPENROUTER_PRIVACY_ATTESTATION_FORMAT}.${encodedPayload}.${sha256(payloadJson)}`;
}

export function parseOpenRouterPrivacyAttestationToken(
  token: string,
): OpenRouterPrivacyAttestationPayload | undefined {
  const [prefix, encodedPayload, checksum, extra] = token.split('.');
  if (
    prefix !== OPENROUTER_PRIVACY_ATTESTATION_FORMAT ||
    !encodedPayload ||
    !isSha256(checksum) ||
    extra !== undefined
  ) {
    return undefined;
  }

  try {
    const payloadJson = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    if (sha256(payloadJson) !== checksum) return undefined;
    const payload = JSON.parse(payloadJson) as Partial<OpenRouterPrivacyAttestationPayload>;
    if (
      payload.format !== OPENROUTER_PRIVACY_ATTESTATION_FORMAT ||
      payload.policyVersion !== TIMELINE_AI_PRIVACY_POLICY_VERSION ||
      !isSha256(payload.catalogSha256) ||
      !isSha256(payload.inferenceKeyFingerprintSha256) ||
      typeof payload.guardrailId !== 'string' ||
      !isValidOpenRouterGuardrailId(payload.guardrailId)
    ) {
      return undefined;
    }
    return payload as OpenRouterPrivacyAttestationPayload;
  } catch {
    return undefined;
  }
}

export function isCurrentOpenRouterPrivacyAttestation(
  token: string | undefined,
  input: { apiKey: string; guardrailId: string },
): boolean {
  if (!token) return false;
  const expected = buildOpenRouterPrivacyAttestationToken(input);
  const actualDigest = Buffer.from(sha256(token), 'hex');
  const expectedDigest = Buffer.from(sha256(expected), 'hex');
  return timingSafeEqual(actualDigest, expectedDigest);
}
