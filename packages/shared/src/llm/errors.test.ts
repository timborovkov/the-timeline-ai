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
    try {
      await wrapAiFailure(
        { operation: 'llm.chatStructured', model: TIMELINE_MODELS.extraction.id },
        () => {
          throw cause;
        },
      );
      throw new Error('expected wrapAiFailure to throw');
    } catch (err) {
      expect(err).toHaveProperty('cause');
      expect((err as { cause?: unknown }).cause).not.toBe(cause);
      expect((err as { cause?: Error }).cause).toMatchObject({
        name: 'Error',
        message: 'provider unavailable',
      });
    }
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

  it('attaches only a sanitized cause with safe provider metadata', async () => {
    const cause = Object.assign(
      new Error('OpenRouter 400 response body: {"messages":[{"content":"private"}]}'),
      {
        name: 'AI_APICallError',
        statusCode: 400,
        isRetryable: false,
      },
    );

    try {
      await wrapAiFailure(
        { operation: 'llm.embedMany', model: TIMELINE_MODELS.embedding.id },
        () => {
          return Promise.reject(cause);
        },
      );
      throw new Error('expected wrapAiFailure to throw');
    } catch (err) {
      const wrappedCause = (
        err as { cause?: Error & { isRetryable?: boolean; statusCode?: number } }
      ).cause;
      expect(wrappedCause).not.toBe(cause);
      expect(wrappedCause).toMatchObject({
        name: 'AI_APICallError',
        message: 'OpenRouter 400 response body: [redacted]',
        statusCode: 400,
        isRetryable: false,
      });
    }
  });

  it('does not attach raw thrown objects as causes', async () => {
    const cause = {
      name: 'AI_APICallError',
      prompt: 'private prompt',
      statusCode: 400,
    };

    try {
      await wrapAiFailure(
        { operation: 'llm.embedMany', model: TIMELINE_MODELS.embedding.id },
        () => {
          // Simulates non-Error provider throws so the wrapper cannot leak raw objects.
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          return Promise.reject(cause);
        },
      );
      throw new Error('expected wrapAiFailure to throw');
    } catch (err) {
      const wrappedCause = (err as { cause?: Error & { statusCode?: number } }).cause;
      expect(wrappedCause).not.toBe(cause);
      expect(wrappedCause).toMatchObject({
        name: 'AI_APICallError',
        message: '[object Object]',
        statusCode: 400,
      });
    }
  });

  it('sanitizes primitive string causes before attaching them', async () => {
    await expect(
      wrapAiFailure({ operation: 'llm.embedMany', model: TIMELINE_MODELS.embedding.id }, () => {
        // Simulates non-Error provider rejections so raw strings cannot leak through Error.cause.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject('OpenRouter 400 response body: {"prompt":"private"}');
      }),
    ).rejects.toMatchObject({
      cause: {
        message: 'OpenRouter 400 response body: [redacted]',
      },
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
