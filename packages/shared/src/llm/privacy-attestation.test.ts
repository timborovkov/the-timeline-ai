import { describe, expect, it } from 'vitest';

import {
  TIMELINE_AI_PRIVACY_POLICY_VERSION,
  timelineModelEntries,
  type TimelineModelConfig,
} from '#src/llm/models.js';
import {
  OPENROUTER_MODEL_CATALOG_FORMAT,
  OPENROUTER_MODEL_CATALOG_SHA256,
  buildOpenRouterPrivacyAttestationPayload,
  buildOpenRouterPrivacyAttestationToken,
  canonicalOpenRouterModelCatalog,
  computeOpenRouterModelCatalogSha256,
  fingerprintOpenRouterInferenceKey,
  isCurrentOpenRouterPrivacyAttestation,
  isValidOpenRouterGuardrailId,
  parseOpenRouterPrivacyAttestationToken,
} from '#src/llm/privacy-attestation.js';

const API_KEY = 'sk-or-v1-test-attestation-key';
const GUARDRAIL_ID = '8b978e76-c028-4f3f-9313-123456789abc';

describe('OpenRouter privacy attestation', () => {
  it('hashes every role and its privacy-relevant catalog fields deterministically', () => {
    const catalog = canonicalOpenRouterModelCatalog();

    expect(catalog.map(({ role }) => role)).toEqual(
      timelineModelEntries()
        .map(([role]) => role)
        .sort(),
    );
    for (const [role, model] of timelineModelEntries()) {
      expect(catalog).toContainEqual({
        role,
        id: model.id,
        privacyMode: model.privacyMode,
        capabilities: [...model.capabilities].sort(),
        limits: {
          contextWindowTokens: model.contextWindowTokens ?? null,
          embeddingDimensions: model.embeddingDimensions ?? null,
        },
      });
    }
    expect(OPENROUTER_MODEL_CATALOG_FORMAT).toBe('timeline-openrouter-model-catalog.v1');
    expect(OPENROUTER_MODEL_CATALOG_SHA256).toBe(
      'f5ecce9794f8c85cc129111d687ee1588589db0223ccf7f46df6da0afc00e763',
    );
  });

  it('is insensitive to role and capability ordering', () => {
    const entries = timelineModelEntries();
    const reordered = [...entries]
      .reverse()
      .map(
        ([role, model]) =>
          [
            role,
            { ...model, capabilities: [...model.capabilities].reverse() },
          ] as const satisfies readonly [string, TimelineModelConfig],
      );
    expect(computeOpenRouterModelCatalogSha256(reordered)).toBe(OPENROUTER_MODEL_CATALOG_SHA256);
  });

  it('changes for every catalog field that affects the inference/privacy contract', () => {
    const model = {
      id: 'provider/model-a',
      provider: 'openrouter',
      privacyMode: 'zdr_required',
      capabilities: ['chat'],
      contextWindowTokens: 10_000,
      embeddingDimensions: 512,
    } as const satisfies TimelineModelConfig;
    const baseline = [['role-a', model]] as const;
    const variants = [
      [['role-b', model]],
      [['role-a', { ...model, id: 'provider/model-b' }]],
      [['role-a', { ...model, privacyMode: 'retained_no_training_exception' as const }]],
      [['role-a', { ...model, capabilities: ['chat', 'vision'] as const }]],
      [['role-a', { ...model, contextWindowTokens: 20_000 }]],
      [['role-a', { ...model, embeddingDimensions: 1536 }]],
    ] as const satisfies readonly (readonly (readonly [string, TimelineModelConfig])[])[];

    for (const variant of variants) {
      expect(computeOpenRouterModelCatalogSha256(variant)).not.toBe(
        computeOpenRouterModelCatalogSha256(baseline),
      );
    }
  });

  it('creates a stable non-secret key fingerprint that rotates with the key', () => {
    const fingerprint = fingerprintOpenRouterInferenceKey(API_KEY);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(fingerprint).not.toContain(API_KEY);
    expect(fingerprintOpenRouterInferenceKey(`${API_KEY}-rotated`)).not.toBe(fingerprint);
    expect(() => fingerprintOpenRouterInferenceKey(` ${API_KEY}`)).toThrow(
      /surrounding whitespace/u,
    );
  });

  it('binds the policy, catalog, inference key, and opaque guardrail id', () => {
    const token = buildOpenRouterPrivacyAttestationToken({
      apiKey: API_KEY,
      guardrailId: GUARDRAIL_ID,
    });
    const payload = parseOpenRouterPrivacyAttestationToken(token);

    expect(payload).toEqual(
      buildOpenRouterPrivacyAttestationPayload({ apiKey: API_KEY, guardrailId: GUARDRAIL_ID }),
    );
    expect(payload).toMatchObject({
      policyVersion: TIMELINE_AI_PRIVACY_POLICY_VERSION,
      catalogSha256: OPENROUTER_MODEL_CATALOG_SHA256,
      inferenceKeyFingerprintSha256: fingerprintOpenRouterInferenceKey(API_KEY),
      guardrailId: GUARDRAIL_ID,
    });
    expect(token).not.toContain(API_KEY);
    expect(
      isCurrentOpenRouterPrivacyAttestation(token, { apiKey: API_KEY, guardrailId: GUARDRAIL_ID }),
    ).toBe(true);
    expect(
      isCurrentOpenRouterPrivacyAttestation(token, {
        apiKey: `${API_KEY}-rotated`,
        guardrailId: GUARDRAIL_ID,
      }),
    ).toBe(false);
    expect(
      isCurrentOpenRouterPrivacyAttestation(token, {
        apiKey: API_KEY,
        guardrailId: `${GUARDRAIL_ID}-replacement`,
      }),
    ).toBe(false);
  });

  it('rejects malformed or tampered tokens and unsafe ids without echoing inputs', () => {
    const token = buildOpenRouterPrivacyAttestationToken({
      apiKey: API_KEY,
      guardrailId: GUARDRAIL_ID,
    });
    expect(parseOpenRouterPrivacyAttestationToken(`${token}x`)).toBeUndefined();
    expect(parseOpenRouterPrivacyAttestationToken('not-an-attestation')).toBeUndefined();
    expect(isValidOpenRouterGuardrailId('opaque_guardrail-id:1')).toBe(true);
    expect(isValidOpenRouterGuardrailId(' guardrail')).toBe(false);
    expect(isValidOpenRouterGuardrailId('guardrail\n')).toBe(false);

    const unsafeKey = ` ${API_KEY}`;
    let message = '';
    try {
      buildOpenRouterPrivacyAttestationToken({ apiKey: unsafeKey, guardrailId: GUARDRAIL_ID });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain(unsafeKey);
  });
});
