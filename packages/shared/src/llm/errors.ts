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
    super(`${metadata.operation} failed`, { cause });
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
  if (cause instanceof Error) return cause.message.slice(0, 500);
  return String(cause).slice(0, 500);
}
