export interface TimelineAiErrorMetadata {
  operation: string;
  model: string;
}

export class TimelineAiError extends Error {
  readonly timelineAi = true;
  readonly operation: string;
  readonly model: string;
  readonly causeName: string;
  readonly causeMessage: string;

  constructor(metadata: TimelineAiErrorMetadata, cause: unknown) {
    super(`${metadata.operation} failed`);
    this.name = 'TimelineAiError';
    this.operation = metadata.operation;
    this.model = metadata.model;
    this.causeName = nameFromCause(cause);
    this.causeMessage = messageFromCause(cause);
  }
}

export function toTimelineAiError(
  metadata: TimelineAiErrorMetadata,
  cause: unknown,
): TimelineAiError {
  if (cause instanceof TimelineAiError) return cause;
  return new TimelineAiError(metadata, cause);
}

export function wrapAiFailure<T>(
  metadata: TimelineAiErrorMetadata,
  fn: () => Promise<T> | T,
): Promise<T> {
  return Promise.resolve()
    .then(fn)
    .catch((err: unknown) => {
      throw toTimelineAiError(metadata, err);
    });
}

function nameFromCause(cause: unknown): string {
  if (cause instanceof Error) return cause.name;
  return typeof cause;
}

function messageFromCause(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (cause instanceof AggregateError) {
    const childMessages = cause.errors.map((err) => {
      const childName = nameFromCause(err);
      const childMessage = err instanceof Error ? err.message : String(err);
      return `${childName}: ${sanitizeCauseMessage(childMessage)}`;
    });
    return sanitizeCauseMessage([message, ...childMessages].join(' | ')).slice(0, 500);
  }
  return sanitizeCauseMessage(message).slice(0, 500);
}

function sanitizeCauseMessage(message: string): string {
  return message
    .replace(/(response\s*(?:body|text|content)\s*[:=]\s*)[\s\S]+/iu, '$1[redacted]')
    .replace(
      /(prompt|transcript|contentText|content_text|messages)\s*[:=]\s*[\s\S]+/iu,
      '$1=[redacted]',
    );
}
