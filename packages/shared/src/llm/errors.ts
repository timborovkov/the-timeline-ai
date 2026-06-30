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
    super(`${metadata.operation} failed`, { cause: safeCause(cause) });
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

function safeCause(cause: unknown): unknown {
  if (cause instanceof AggregateError) {
    return new AggregateError(
      cause.errors.map((err) => safeCause(err)),
      sanitizeCauseMessage(cause.message).slice(0, 500),
    );
  }
  if (typeof cause === 'string') return new Error(sanitizeCauseMessage(cause).slice(0, 500));
  if (!(cause instanceof Error)) {
    if (!cause || typeof cause !== 'object') return cause;
    const row = cause as {
      isRetryable?: unknown;
      name?: unknown;
      responseStatus?: unknown;
      status?: unknown;
      statusCode?: unknown;
    };
    const safe = new Error(
      sanitizeCauseMessage(Object.prototype.toString.call(cause)).slice(0, 500),
    ) as Error & {
      isRetryable?: boolean;
      responseStatus?: number;
      status?: number;
      statusCode?: number;
    };
    if (typeof row.name === 'string') safe.name = row.name;
    copyNumber(row, safe, 'statusCode');
    copyNumber(row, safe, 'status');
    copyNumber(row, safe, 'responseStatus');
    if (typeof row.isRetryable === 'boolean') safe.isRetryable = row.isRetryable;
    return safe;
  }
  const row = cause as {
    cause?: unknown;
    isRetryable?: unknown;
    responseStatus?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  const safe = new Error(sanitizeCauseMessage(cause.message).slice(0, 500), {
    cause: 'cause' in row ? safeCause(row.cause) : undefined,
  }) as Error & {
    isRetryable?: boolean;
    responseStatus?: number;
    status?: number;
    statusCode?: number;
  };
  safe.name = cause.name;
  copyNumber(row, safe, 'statusCode');
  copyNumber(row, safe, 'status');
  copyNumber(row, safe, 'responseStatus');
  if (typeof row.isRetryable === 'boolean') safe.isRetryable = row.isRetryable;
  return safe;
}

function copyNumber(
  source: Record<string, unknown>,
  target: { responseStatus?: number; status?: number; statusCode?: number },
  key: 'responseStatus' | 'status' | 'statusCode',
): void {
  const value = source[key];
  if (typeof value === 'number') target[key] = value;
}
