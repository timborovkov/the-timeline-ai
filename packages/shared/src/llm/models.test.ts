import { describe, expect, it } from 'vitest';

import { TIMELINE_MODELS } from './models.js';

describe('TIMELINE_MODELS', () => {
  it('matches OpenRouter metadata for GPT-4o-mini chat-capable roles', () => {
    const expectedCapabilities = ['chat', 'structured', 'tools', 'vision', 'file'];

    for (const key of ['extraction', 'agent', 'summarization', 'vision'] as const) {
      expect(TIMELINE_MODELS[key]).toMatchObject({
        id: 'openai/gpt-4o-mini',
        provider: 'openrouter',
        contextWindowTokens: 128_000,
        capabilities: expectedCapabilities,
      });
    }
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
});
