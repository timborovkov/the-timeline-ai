import { type Mock, vi } from 'vitest';

type QueueMock = Mock<() => Promise<void>>;

interface TextQueueDeps {
  extract: { enqueueExtract: QueueMock };
  embed: { enqueueEmbed: QueueMock };
  suggestions: { enqueueSuggestion: QueueMock };
}

export function textQueueDeps(): TextQueueDeps {
  return {
    extract: { enqueueExtract: vi.fn().mockResolvedValue(undefined) },
    embed: { enqueueEmbed: vi.fn().mockResolvedValue(undefined) },
    suggestions: { enqueueSuggestion: vi.fn().mockResolvedValue(undefined) },
  };
}
