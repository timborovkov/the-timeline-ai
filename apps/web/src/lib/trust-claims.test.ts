import {
  TIMELINE_AI_PRIVACY_POLICY_VERSION,
  TIMELINE_MODELS,
  timelineModelEntries,
} from '@timeline/shared/llm';
import { describe, expect, it } from 'vitest';

import {
  PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS,
  TRUST_AI_MODEL_ITEMS,
  TRUST_AI_PRIVACY_LABELS,
  TRUST_AI_PRIVACY_SUMMARY,
  TRUST_AI_ROUTES,
  buildPublicTranscriptionPrivacyClaims,
} from '@/lib/trust-claims';

describe('public AI trust claims', () => {
  it('derives every published model and privacy classification from the code-owned registry', () => {
    expect(TRUST_AI_ROUTES).toEqual([
      expect.objectContaining({
        model: `${TIMELINE_MODELS.agent.id} + ${TIMELINE_MODELS.structuredFallback.id}`,
        privacyMode: 'zdr_required',
      }),
      expect.objectContaining({
        model: TIMELINE_MODELS.vision.id,
        privacyMode: 'zdr_required',
      }),
      expect.objectContaining({
        model: TIMELINE_MODELS.embedding.id,
        privacyMode: 'zdr_required',
      }),
      expect.objectContaining({
        model: TIMELINE_MODELS.transcription.id,
        privacyMode: 'retained_no_training_exception',
      }),
    ]);
    expect(TRUST_AI_MODEL_ITEMS).toHaveLength(TRUST_AI_ROUTES.length);
  });

  it('projects every code-owned model role exactly once and deduplicates shared pins', () => {
    const publishedRoles = TRUST_AI_ROUTES.flatMap((route) => route.roles);
    const registryRoles = timelineModelEntries().map(([role]) => role);

    expect([...publishedRoles].sort()).toEqual([...registryRoles].sort());
    expect(new Set(publishedRoles).size).toBe(publishedRoles.length);
    for (const route of TRUST_AI_ROUTES) {
      const expectedModels = [...new Set(route.roles.map((role) => TIMELINE_MODELS[role].id))];
      expect(route.model).toBe(expectedModels.join(' + '));
    }
  });

  it('publishes the versioned quality exception instead of a blanket ZDR claim', () => {
    expect(TRUST_AI_PRIVACY_SUMMARY).toContain(TIMELINE_AI_PRIVACY_POLICY_VERSION);
    expect(TRUST_AI_PRIVACY_SUMMARY).toContain(TIMELINE_MODELS.transcription.id);
    expect(TRUST_AI_PRIVACY_SUMMARY).toContain('up to 30 days');
    expect(TRUST_AI_PRIVACY_SUMMARY).toContain('fail closed');
    expect(TRUST_AI_PRIVACY_LABELS.retained_no_training_exception).toContain('quality exception');
    expect(TRUST_AI_PRIVACY_SUMMARY).not.toContain('every model group Timeline uses');
  });

  it('keeps the retained outcome in exact parity with its registry disclosure', () => {
    const claims = buildPublicTranscriptionPrivacyClaims(TIMELINE_MODELS.transcription);

    expect(PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS).toEqual(claims);
    expect(claims).toMatchObject({
      model: 'openai/gpt-4o-transcribe',
      privacyMode: 'retained_no_training_exception',
      privacyLabel: 'Retained, no-training quality exception',
      trustSignalValue: 'ZDR by role',
      retentionSources: [
        { href: 'https://openrouter.ai/providers' },
        {
          href: 'https://platform.openai.com/docs/models/default-usage-policies-by-endpoint',
        },
      ],
    });
    const publishedCopy = JSON.stringify(claims);
    expect(publishedCopy).toContain('openai/gpt-4o-transcribe');
    expect(publishedCopy).toContain('not training on prompts but retaining them');
    expect(publishedCopy).toContain('up to 30 days');
    expect(TRUST_AI_ROUTES.at(-1)).toEqual({
      job: 'Non-meeting voice-note speech-to-text',
      roles: ['transcription'],
      model: claims.model,
      privacyMode: claims.privacyMode,
      selection: claims.routeSelection,
    });
  });

  it('generates the complete ZDR outcome without retained-provider residue', () => {
    const claims = buildPublicTranscriptionPrivacyClaims({
      id: 'google/chirp-3',
      privacyMode: 'zdr_required',
    });

    expect(claims).toEqual({
      model: 'google/chirp-3',
      privacyMode: 'zdr_required',
      privacyLabel: 'ZDR required',
      routeSelection:
        'Quality-approved speech-to-text with a required ZDR route and no weaker-retention fallback.',
      privacySummary:
        'Non-meeting voice transcription uses google/chirp-3 after passing the documented broad-multilingual quality gate. It requires an eligible ZDR endpoint and fails closed instead of using a weaker-retention route.',
      privacyZdrRoleList:
        'generation, extraction, summarization, media text extraction, embeddings, and non-meeting voice transcription',
      trustSignalValue: 'ZDR for every AI role',
      trustSignalDetail:
        'Every code-owned AI role, including voice-note transcription, requires eligible ZDR routing and fails closed.',
      trustIntro:
        'Core AI roles, including non-meeting voice transcription, require zero-data-retention routes.',
      trustDataPath:
        'Only the content needed for a feature leaves Timeline. Every AI role requires an eligible ZDR route and stops rather than request weaker retention.',
      trustDetail:
        'Voice-note transcription uses google/chirp-3 after passing the documented broad-multilingual quality gate. It requires an eligible ZDR endpoint and cannot fall back to weaker retention.',
      trustChecklist: 'Voice-note transcription is pinned to a quality-approved ZDR route',
      privacyDetail:
        'Non-meeting voice-note transcription uses google/chirp-3 after passing the documented broad-multilingual quality gate. It requires an eligible ZDR endpoint, carries the supported no-collection and cache-disable controls, and fails closed instead of using weaker retention.',
      privacyProviderPurpose:
        'Zero-data-retention-required routing for generation, extraction, media processing, embeddings, and non-meeting voice-note transcription; and non-content usage metadata.',
      privacyRetentionDetail:
        'google/chirp-3 is classified as ZDR required. Timeline requires an eligible zero-data-retention endpoint and fails rather than use a weaker-retention transcription route.',
      termsDetail:
        'Non-meeting voice transcription uses google/chirp-3 as a quality-approved ZDR route after passing the documented broad-multilingual quality gate. It may not downgrade to weaker retention during an outage.',
      retentionSources: [],
    });

    const publishedCopy = JSON.stringify(claims);
    expect(publishedCopy).not.toMatch(/openai|gpt-4o|30 days|quality exception|prompt-retaining/iu);
  });

  it('fails closed when retained disclosure metadata and the privacy class disagree', () => {
    expect(() =>
      buildPublicTranscriptionPrivacyClaims({
        id: 'provider/retained-transcriber',
        privacyMode: 'retained_no_training_exception',
      }),
    ).toThrow(/requires provider-specific public disclosure/iu);

    expect(() =>
      buildPublicTranscriptionPrivacyClaims({
        id: 'provider/zdr-transcriber',
        privacyMode: 'zdr_required',
        retainedNoTrainingDisclosure: TIMELINE_MODELS.transcription.retainedNoTrainingDisclosure,
      }),
    ).toThrow(/must not carry retained-route disclosure/iu);
  });
});
