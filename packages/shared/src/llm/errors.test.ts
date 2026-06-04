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
      causeMessage: 'provider unavailable',
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

  it('redacts likely provider payloads from bounded cause messages', async () => {
    await expect(
      wrapAiFailure(
        { operation: 'llm.chatStructured', model: TIMELINE_MODELS.extraction.id },
        () => {
          throw new Error('OpenRouter 400 response body: {"prompt":"private timeline note"}');
        },
      ),
    ).rejects.toMatchObject({
      causeMessage: 'OpenRouter 400 response body: [redacted]',
    });
  });

  it('keeps sanitized child messages for aggregate structured-output failures', async () => {
    await expect(
      wrapAiFailure(
        { operation: 'llm.chatStructured', model: TIMELINE_MODELS.extraction.id },
        () => {
          throw new AggregateError(
            [
              new Error('json_schema unsupported by provider'),
              new Error('OpenRouter 400 response body: {"messages":[{"content":"private"}]}'),
            ],
            'llm.chatStructured failed with json_schema and json_object response formats',
          );
        },
      ),
    ).rejects.toMatchObject({
      causeName: 'AggregateError',
      causeMessage:
        'llm.chatStructured failed with json_schema and json_object response formats | Error: json_schema unsupported by provider | Error: OpenRouter 400 response body: [redacted]',
    });
  });
});
