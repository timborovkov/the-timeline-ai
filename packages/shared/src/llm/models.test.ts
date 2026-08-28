import { describe, expect, it } from 'vitest';

import { currentExtractionModelVersions } from '#src/extraction-model-version.js';
import {
  TIMELINE_AI_PRIVACY_POLICY_VERSION,
  TIMELINE_MODELS,
  timelineModelEntries,
  uniqueTimelineModelsByPrivacyMode,
} from '#src/llm/models.js';

describe('TIMELINE_MODELS', () => {
  it('matches OpenRouter metadata for OSS chat-capable roles', () => {
    expect(TIMELINE_MODELS.extraction).toMatchObject({
      id: 'deepseek/deepseek-v4-flash-0731',
      provider: 'openrouter',
      privacyMode: 'zdr_required',
      contextWindowTokens: 1_048_576,
      capabilities: ['chat', 'structured', 'tools'],
    });
    expect(TIMELINE_MODELS.agent).toMatchObject({
      id: 'deepseek/deepseek-v4-flash-0731',
      provider: 'openrouter',
      privacyMode: 'zdr_required',
      contextWindowTokens: 1_048_576,
      capabilities: ['chat', 'structured', 'tools'],
    });
    expect(TIMELINE_MODELS.structuredFallback).toMatchObject({
      id: 'deepseek/deepseek-v4-pro',
      provider: 'openrouter',
      privacyMode: 'zdr_required',
      contextWindowTokens: 1_048_576,
      capabilities: ['chat', 'structured', 'tools'],
    });
    expect(TIMELINE_MODELS.summarization).toMatchObject({
      id: 'deepseek/deepseek-v4-flash-0731',
      provider: 'openrouter',
      privacyMode: 'zdr_required',
      contextWindowTokens: 1_048_576,
      capabilities: ['chat', 'structured', 'tools'],
    });
    expect(TIMELINE_MODELS.taskCategorization).toMatchObject({
      id: 'deepseek/deepseek-v4-flash-0731',
      provider: 'openrouter',
      privacyMode: 'zdr_required',
      contextWindowTokens: 1_048_576,
      capabilities: ['chat', 'structured'],
    });
  });

  it('matches OpenRouter metadata for the PDF-capable vision role', () => {
    expect(TIMELINE_MODELS.vision).toMatchObject({
      id: 'google/gemini-3.5-flash',
      provider: 'openrouter',
      privacyMode: 'zdr_required',
      contextWindowTokens: 1_048_576,
      capabilities: ['chat', 'structured', 'tools', 'vision', 'file', 'audio', 'video'],
    });
  });

  it('matches OpenRouter metadata for embeddings and transcription', () => {
    expect(TIMELINE_MODELS.embedding).toMatchObject({
      id: 'openai/text-embedding-3-small',
      provider: 'openrouter',
      privacyMode: 'zdr_required',
      contextWindowTokens: 8_192,
      embeddingDimensions: 1536,
      capabilities: ['embedding'],
    });
    expect(TIMELINE_MODELS.transcription).toMatchObject({
      id: 'openai/gpt-4o-transcribe',
      provider: 'openrouter',
      privacyMode: 'retained_no_training_exception',
      retainedNoTrainingDisclosure: {
        openRouter: {
          href: 'https://openrouter.ai/providers',
          statement: 'lists OpenAI as not training on prompts but retaining them',
        },
        upstream: {
          href: 'https://platform.openai.com/docs/models/default-usage-policies-by-endpoint',
          statement:
            'document default API abuse-monitoring retention of inputs and outputs for up to 30 days',
        },
      },
      capabilities: ['transcription'],
    });
  });

  it('classifies every code-owned role under the current privacy policy', () => {
    expect(TIMELINE_AI_PRIVACY_POLICY_VERSION).toBe('2026-08-21.1');
    expect(timelineModelEntries()).toHaveLength(Object.keys(TIMELINE_MODELS).length);
    expect(uniqueTimelineModelsByPrivacyMode('retained_no_training_exception')).toEqual([
      TIMELINE_MODELS.transcription,
    ]);
    expect(uniqueTimelineModelsByPrivacyMode('zdr_required').map((model) => model.id)).toEqual(
      expect.arrayContaining([
        TIMELINE_MODELS.agent.id,
        TIMELINE_MODELS.structuredFallback.id,
        TIMELINE_MODELS.vision.id,
        TIMELINE_MODELS.embedding.id,
      ]),
    );
    for (const [, model] of timelineModelEntries()) {
      if (model.privacyMode === 'retained_no_training_exception') {
        expect(model.retainedNoTrainingDisclosure).toBeDefined();
      } else {
        expect(model.retainedNoTrainingDisclosure).toBeUndefined();
      }
    }
  });

  it('treats primary and structured fallback extraction versions as current', () => {
    expect(currentExtractionModelVersions()).toEqual(
      expect.arrayContaining([
        expect.stringContaining(TIMELINE_MODELS.extraction.id),
        expect.stringContaining(TIMELINE_MODELS.structuredFallback.id),
      ]),
    );
  });
});
