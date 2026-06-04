export interface TimelineAiErrorMetadata {
  operation: string;
  model: string;
}

export class TimelineAiError extends Error {
  readonly timelineAi = true;
  readonly operation: string;
  readonly model: string;

  constructor(metadata: TimelineAiErrorMetadata, cause: unknown) {
    super(`${metadata.operation} failed: ${messageFromCause(cause)}`, { cause });
    this.name = 'TimelineAiError';
    this.operation = metadata.operation;
    this.model = metadata.model;
  }
}

export function wrapAiFailure<T>(
  metadata: TimelineAiErrorMetadata,
  fn: () => Promise<T> | T,
): Promise<T> {
  return Promise.resolve()
    .then(fn)
    .catch((err: unknown) => {
      if (err instanceof TimelineAiError) throw err;
      throw new TimelineAiError(metadata, err);
    });
}

function messageFromCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return typeof cause === 'string' ? cause : 'unknown error';
}
