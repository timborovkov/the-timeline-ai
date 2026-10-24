/**
 * The provider-backed bake-off must spend only on ZDR-listed candidates, enforce
 * every quality/latency/error gate against the retained baseline, and rank passing
 * models without persisting transcript-bearing case evidence. The transport and
 * corpus reader are pure fakes; no files, customer data, or network calls are used.
 */
import path from 'node:path';

import { TIMELINE_MODELS, buildOpenRouterPrivacyAttestationPayload } from '@timeline/shared/llm';
import { describe, expect, it, vi } from 'vitest';

import type {
  TranscriptionEvalTransport,
  TranscriptionEvalZdrRoutes,
} from '#src/transcription-eval/evaluate.js';
import type { LoadedTranscriptionEvalManifest } from '#src/transcription-eval/manifest.js';

import { runTranscriptionQualityEval } from '#src/transcription-eval/evaluate.js';
import { buildValidTranscriptionEvalManifest } from '#src/transcription-eval/test-fixtures.js';

const BASELINE_MODEL_ID = TIMELINE_MODELS.transcription.id;
const PRIVACY_ATTESTATION = buildOpenRouterPrivacyAttestationPayload({
  apiKey: 'sk-or-v1-synthetic-eval-test-key',
  guardrailId: 'synthetic-eval-guardrail',
});

function safeZdrRoute(
  provider: string,
  tag: string,
  endpointCount = 1,
): TranscriptionEvalZdrRoutes {
  return {
    endpointCount,
    providers: [provider],
    tags: [tag],
    inventoryStatus: 'verified',
    inventoryEndpointCount: endpointCount,
    inventoryTags: Array.from({ length: endpointCount }, () => tag),
    matchedZdrEndpointCount: endpointCount,
    nonZdrEndpointCount: 0,
    allEligibleEndpointsZdr: true,
  };
}

function noZdrRoute(): TranscriptionEvalZdrRoutes {
  return {
    endpointCount: 0,
    providers: [],
    tags: [],
    inventoryStatus: 'verified',
    inventoryEndpointCount: 1,
    inventoryTags: ['regular/provider'],
    matchedZdrEndpointCount: 0,
    nonZdrEndpointCount: 1,
    allEligibleEndpointsZdr: false,
  };
}

function mixedRegularAndZdrRoute(): TranscriptionEvalZdrRoutes {
  return {
    endpointCount: 1,
    providers: ['Mistral'],
    tags: ['mistral/zdr'],
    inventoryStatus: 'verified',
    inventoryEndpointCount: 2,
    inventoryTags: ['mistral', 'mistral/zdr'],
    matchedZdrEndpointCount: 1,
    nonZdrEndpointCount: 1,
    allEligibleEndpointsZdr: false,
  };
}

function loadedManifest(): LoadedTranscriptionEvalManifest {
  return {
    manifest: buildValidTranscriptionEvalManifest(),
    manifestDirectory: '/tmp/approved-transcription-corpus',
    manifestSha256: 'a'.repeat(64),
  };
}

function audioReader(
  loaded: LoadedTranscriptionEvalManifest,
): (filePath: string) => Promise<Buffer> {
  const references = new Map(
    loaded.manifest.cases.map((fixture) => [
      path.resolve(loaded.manifestDirectory, fixture.audioPath),
      fixture.referenceText || '__synthetic_silence__',
    ]),
  );
  return (filePath) => {
    const reference = references.get(filePath);
    if (!reference) throw new Error('missing synthetic fixture');
    return Promise.resolve(Buffer.from(reference));
  };
}

function syntheticAudioPathResolver(manifestDirectory: string, audioPath: string): Promise<string> {
  return Promise.resolve(path.resolve(manifestDirectory, audioPath));
}

function transcriptFromAudio(audio: Buffer): string {
  const value = audio.toString('utf8');
  return value === '__synthetic_silence__' ? '' : value;
}

describe('transcription quality evaluation', () => {
  it('ranks only candidates that pass every exact quality and latency gate', async () => {
    const loaded = loadedManifest();
    const transport: TranscriptionEvalTransport = {
      inspectZdrRoutes: vi.fn().mockResolvedValue(
        new Map([
          ['openai/whisper-large-v3', safeZdrRoute('Groq', 'groq/zdr', 3)],
          ['google/chirp-3', safeZdrRoute('Google Vertex', 'google/zdr')],
        ]),
      ),
      transcribe: vi
        .fn<TranscriptionEvalTransport['transcribe']>()
        .mockImplementation(({ modelId, audio }) =>
          Promise.resolve({
            ok: true as const,
            text: transcriptFromAudio(audio),
            latencyMs:
              modelId === BASELINE_MODEL_ID
                ? 100
                : modelId === 'openai/whisper-large-v3'
                  ? 105
                  : 110,
            costUsd: modelId === 'google/chirp-3' ? 0.0005 : 0.001,
            provider: modelId === 'google/chirp-3' ? 'Google Vertex' : 'Groq',
            dataRegion: 'global',
          }),
        ),
    };

    const report = await runTranscriptionQualityEval(
      {
        loadedManifest: loaded,
        baselineModelId: BASELINE_MODEL_ID,
        candidateModelIds: ['openai/whisper-large-v3', 'google/chirp-3'],
        privacyPolicyAttestation: PRIVACY_ATTESTATION,
        requestBudgetMs: 120_000,
        concurrency: 3,
      },
      {
        transport,
        readAudio: audioReader(loaded),
        resolveAudioPath: syntheticAudioPathResolver,
        now: () => new Date('2026-08-21T10:00:00Z'),
      },
    );

    expect(report.selection).toEqual({
      status: 'candidate_passed',
      recommendedModelId: 'openai/whisper-large-v3',
    });
    expect(report.ranking).toEqual(['openai/whisper-large-v3', 'google/chirp-3']);
    expect(report.languageHintMode).toBe('auto_detect');
    expect(report.privacyPolicyAttestation).toEqual({
      ...PRIVACY_ATTESTATION,
      evidenceKind: 'operator_attestation',
      isProviderProof: false,
    });
    expect(report.models.filter(({ eligible }) => eligible)).toHaveLength(2);
    expect(report.models[1]?.actualRouteVerification).toMatchObject({
      successfulRequestCount: 24,
      verifiedZdrRequestCount: 24,
      missingRouteMetadataCount: 0,
      nonZdrRouteCount: 0,
      allSuccessfulRequestsVerified: true,
    });
    expect(report.models[1]?.endpointIsolation).toMatchObject({
      requiredForEvaluation: true,
      inventoryStatus: 'verified',
      inventoryEndpointCount: 3,
      matchedZdrEndpointCount: 3,
      nonZdrEndpointCount: 0,
      allEligibleEndpointsZdr: true,
    });
    expect(report.models[1]?.endpointIsolation.zdrTagSetSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      report.models
        .filter(({ role }) => role === 'candidate')
        .flatMap(({ gateChecks }) => gateChecks)
        .every(({ passed }) => passed),
    ).toBe(true);
    expect(report.corpus).toMatchObject({
      caseCount: 24,
      languageCount: 24,
      languageFamilyCount: 8,
      manifestSha256: 'a'.repeat(64),
    });
    expect(JSON.stringify(report)).not.toContain('Alice meets Bob');
    expect(JSON.stringify(report)).not.toContain('/tmp/approved-transcription-corpus');
    expect(JSON.stringify(report)).not.toContain('groq/zdr');
  });

  it('does not send audio to candidates absent from the live ZDR registry', async () => {
    const loaded = loadedManifest();
    const transcribe = vi
      .fn<TranscriptionEvalTransport['transcribe']>()
      .mockImplementation(({ audio }) =>
        Promise.resolve({
          ok: true as const,
          text: transcriptFromAudio(audio),
          latencyMs: 100,
        }),
      );
    const transport: TranscriptionEvalTransport = {
      inspectZdrRoutes: vi.fn().mockResolvedValue(new Map([['example/non-zdr', noZdrRoute()]])),
      transcribe,
    };

    const report = await runTranscriptionQualityEval(
      {
        loadedManifest: loaded,
        baselineModelId: BASELINE_MODEL_ID,
        candidateModelIds: ['example/non-zdr'],
        privacyPolicyAttestation: PRIVACY_ATTESTATION,
        requestBudgetMs: 120_000,
      },
      {
        transport,
        readAudio: audioReader(loaded),
        resolveAudioPath: syntheticAudioPathResolver,
      },
    );

    expect(transcribe).toHaveBeenCalledTimes(24);
    expect(transcribe).not.toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'example/non-zdr' }),
    );
    expect(report.models[1]).toMatchObject({
      modelId: 'example/non-zdr',
      metrics: null,
      eligible: false,
    });
    expect(report.models[1]?.gateChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'zdr_registry', passed: false }),
        expect.objectContaining({ id: 'actual_zdr_routes', passed: false }),
      ]),
    );
    expect(report.selection.status).toBe('no_candidate_passed');
  });

  it('does not upload candidate audio when regular and ZDR endpoint tags are both eligible', async () => {
    const loaded = loadedManifest();
    const inspectZdrRoutes = vi
      .fn<TranscriptionEvalTransport['inspectZdrRoutes']>()
      .mockResolvedValue(
        new Map([['mistralai/voxtral-mini-transcribe', mixedRegularAndZdrRoute()]]),
      );
    const transcribe = vi
      .fn<TranscriptionEvalTransport['transcribe']>()
      .mockImplementation(({ audio }) =>
        Promise.resolve({
          ok: true as const,
          text: transcriptFromAudio(audio),
          latencyMs: 100,
          provider: 'OpenAI',
        }),
      );

    const report = await runTranscriptionQualityEval(
      {
        loadedManifest: loaded,
        baselineModelId: BASELINE_MODEL_ID,
        candidateModelIds: ['mistralai/voxtral-mini-transcribe'],
        privacyPolicyAttestation: PRIVACY_ATTESTATION,
        requestBudgetMs: 120_000,
      },
      {
        transport: { inspectZdrRoutes, transcribe },
        readAudio: audioReader(loaded),
        resolveAudioPath: syntheticAudioPathResolver,
      },
    );

    expect(inspectZdrRoutes).toHaveBeenCalledWith(['mistralai/voxtral-mini-transcribe']);
    expect(transcribe).toHaveBeenCalledTimes(24);
    expect(transcribe).not.toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'mistralai/voxtral-mini-transcribe' }),
    );
    expect(report.models[1]).toMatchObject({
      metrics: null,
      eligible: false,
      endpointIsolation: {
        inventoryStatus: 'verified',
        inventoryEndpointCount: 2,
        matchedZdrEndpointCount: 1,
        nonZdrEndpointCount: 1,
        allEligibleEndpointsZdr: false,
      },
    });
    expect(report.models[1]?.gateChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'endpoint_isolation', passed: false }),
      ]),
    );
  });

  it.each([
    {
      label: 'does not return generation provider metadata',
      provider: undefined,
      missingRouteMetadataCount: 24,
      nonZdrRouteCount: 0,
    },
    {
      label: 'returns a provider outside the current ZDR route set',
      provider: 'Non-ZDR Provider',
      missingRouteMetadataCount: 0,
      nonZdrRouteCount: 24,
    },
  ])('rejects a quality-passing candidate that $label', async (routeCase) => {
    const loaded = loadedManifest();
    const transport: TranscriptionEvalTransport = {
      inspectZdrRoutes: vi
        .fn()
        .mockResolvedValue(
          new Map([['google/chirp-3', safeZdrRoute('Google Vertex', 'google/zdr')]]),
        ),
      transcribe: vi
        .fn<TranscriptionEvalTransport['transcribe']>()
        .mockImplementation(({ modelId, audio }) =>
          Promise.resolve({
            ok: true as const,
            text: transcriptFromAudio(audio),
            latencyMs: 100,
            ...(modelId === 'google/chirp-3' && routeCase.provider
              ? { provider: routeCase.provider }
              : modelId === BASELINE_MODEL_ID
                ? { provider: 'OpenAI' }
                : {}),
          }),
        ),
    };

    const report = await runTranscriptionQualityEval(
      {
        loadedManifest: loaded,
        baselineModelId: BASELINE_MODEL_ID,
        candidateModelIds: ['google/chirp-3'],
        privacyPolicyAttestation: PRIVACY_ATTESTATION,
        requestBudgetMs: 120_000,
      },
      {
        transport,
        readAudio: audioReader(loaded),
        resolveAudioPath: syntheticAudioPathResolver,
      },
    );
    const candidate = report.models[1];

    expect(candidate?.eligible).toBe(false);
    expect(candidate?.actualRouteVerification).toMatchObject({
      successfulRequestCount: 24,
      verifiedZdrRequestCount: 0,
      missingRouteMetadataCount: routeCase.missingRouteMetadataCount,
      nonZdrRouteCount: routeCase.nonZdrRouteCount,
      allSuccessfulRequestsVerified: false,
    });
    expect(candidate?.gateChecks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'actual_zdr_routes', passed: false })]),
    );
    expect(report.selection).toEqual({
      status: 'no_candidate_passed',
      recommendedModelId: null,
    });
  });

  it('rejects baseline drift and stale operator attestation before transport access', async () => {
    const loaded = loadedManifest();
    const inspectZdrRoutes = vi.fn();
    const transport: TranscriptionEvalTransport = {
      inspectZdrRoutes,
      transcribe: vi.fn(),
    };
    const baseInput = {
      loadedManifest: loaded,
      baselineModelId: BASELINE_MODEL_ID,
      candidateModelIds: ['google/chirp-3'],
      privacyPolicyAttestation: PRIVACY_ATTESTATION,
      requestBudgetMs: 120_000,
    };

    await expect(
      runTranscriptionQualityEval(
        { ...baseInput, baselineModelId: 'example/stale-baseline' },
        {
          transport,
          readAudio: audioReader(loaded),
          resolveAudioPath: syntheticAudioPathResolver,
        },
      ),
    ).rejects.toThrow(/production transcription model/u);
    await expect(
      runTranscriptionQualityEval(
        {
          ...baseInput,
          privacyPolicyAttestation: {
            ...PRIVACY_ATTESTATION,
            catalogSha256: 'f'.repeat(64),
          },
        },
        {
          transport,
          readAudio: audioReader(loaded),
          resolveAudioPath: syntheticAudioPathResolver,
        },
      ),
    ).rejects.toThrow(/current model catalog and privacy policy/u);
    expect(inspectZdrRoutes).not.toHaveBeenCalled();
  });

  it('rejects a candidate with a quality regression in one language slice', async () => {
    const loaded = loadedManifest();
    const transport: TranscriptionEvalTransport = {
      inspectZdrRoutes: vi
        .fn()
        .mockResolvedValue(
          new Map([['google/chirp-3', safeZdrRoute('Google Vertex', 'google/zdr')]]),
        ),
      transcribe: vi
        .fn<TranscriptionEvalTransport['transcribe']>()
        .mockImplementation(({ modelId, audio }) =>
          Promise.resolve({
            ok: true as const,
            text:
              modelId === 'google/chirp-3' && audio.toString('utf8') === 'Synthetic speech sample 1'
                ? 'completely incorrect synthetic output'
                : transcriptFromAudio(audio),
            latencyMs: 100,
            provider: modelId === 'google/chirp-3' ? 'Google Vertex' : 'OpenAI',
          }),
        ),
    };

    const report = await runTranscriptionQualityEval(
      {
        loadedManifest: loaded,
        baselineModelId: BASELINE_MODEL_ID,
        candidateModelIds: ['google/chirp-3'],
        privacyPolicyAttestation: PRIVACY_ATTESTATION,
        requestBudgetMs: 120_000,
      },
      {
        transport,
        readAudio: audioReader(loaded),
        resolveAudioPath: syntheticAudioPathResolver,
      },
    );
    const candidate = report.models[1];

    expect(candidate?.eligible).toBe(false);
    expect(candidate?.gateChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'language_slice_wer', passed: false, worstSlice: 'en' }),
        expect.objectContaining({ id: 'language_slice_cer', passed: false, worstSlice: 'en' }),
      ]),
    );
    expect(report.selection.status).toBe('no_candidate_passed');
  });
});
