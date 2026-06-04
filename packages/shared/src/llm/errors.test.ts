import { describe, expect, it } from 'vitest';

import { TimelineAiError, wrapAiFailure } from '#src/llm/errors.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';

describe('TimelineAiError', () => {
  it('wraps provider failures with safe operation and model metadata', async () => {
    const cause = new Error('provider unavailable');

    await expect(
      wrapAiFailure(
        { operation: 'llm.chatStructured', model: TIMELINE_MODELS.extraction.id },
        () => {
          throw cause;
        },
      ),
    ).rejects.toMatchObject({
      name: 'TimelineAiError',
      timelineAi: true,
      operation: 'llm.chatStructured',
      model: TIMELINE_MODELS.extraction.id,
      causeName: 'Error',
    });
    await expect(
      wrapAiFailure(
        { operation: 'llm.chatStructured', model: TIMELINE_MODELS.extraction.id },
        () => {
          throw cause;
        },
      ),
    ).rejects.not.toHaveProperty('cause');
  });

  it('does not double-wrap existing AI failures', async () => {
    const err = new TimelineAiError(
      { operation: 'llm.embed', model: TIMELINE_MODELS.embedding.id },
      new Error('upstream'),
    );

    await expect(
      wrapAiFailure({ operation: 'llm.chatStructured', model: 'other' }, () => {
        throw err;
      }),
    ).rejects.toBe(err);
  });
});
