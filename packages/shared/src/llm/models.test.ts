import { describe, expect, it } from 'vitest';

import { currentExtractionModelVersions } from '#src/extraction-model-version.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';

describe('TIMELINE_MODELS', () => {
  it('matches OpenRouter metadata for OSS chat-capable roles', () => {
    expect(TIMELINE_MODELS.extraction).toMatchObject({
      id: 'qwen/qwen3.7-max',
      provider: 'openrouter',
      contextWindowTokens: 1_000_000,
      capabilities: ['chat', 'structured', 'tools'],
    });
    expect(TIMELINE_MODELS.agent).toMatchObject({
      id: 'qwen/qwen3.7-max',
      provider: 'openrouter',
      contextWindowTokens: 1_000_000,
      capabilities: ['chat', 'structured', 'tools'],
    });
    expect(TIMELINE_MODELS.structuredFallback).toMatchObject({
      id: 'deepseek/deepseek-v4-flash',
      provider: 'openrouter',
      contextWindowTokens: 1_048_576,
      capabilities: ['chat', 'structured', 'tools'],
    });
    expect(TIMELINE_MODELS.summarization).toMatchObject({
      id: 'deepseek/deepseek-v4-flash',
      provider: 'openrouter',
      contextWindowTokens: 1_048_576,
      capabilities: ['chat', 'structured', 'tools'],
    });
  });

  it('matches OpenRouter metadata for the OSS vision role', () => {
    expect(TIMELINE_MODELS.vision).toMatchObject({
      id: 'qwen/qwen3.6-flash',
      provider: 'openrouter',
      contextWindowTokens: 1_000_000,
      capabilities: ['chat', 'structured', 'tools', 'vision', 'video'],
    });
  });

  it('matches OpenRouter metadata for embeddings and transcription', () => {
    expect(TIMELINE_MODELS.embedding).toMatchObject({
      id: 'openai/text-embedding-3-small',
      provider: 'openrouter',
      contextWindowTokens: 8_192,
      embeddingDimensions: 1536,
      capabilities: ['embedding'],
    });
    expect(TIMELINE_MODELS.transcription).toMatchObject({
      id: 'openai/whisper-large-v3',
      provider: 'openrouter',
      capabilities: ['transcription'],
    });
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
