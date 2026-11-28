const OBJECT_NOT_FOUND_CODE = 'TIMELINE_OBJECT_NOT_FOUND';

export class StaleWorkspaceStateError extends Error {
  constructor() {
    super('This item changed. Read its current state and request approval again.');
    this.name = 'StaleWorkspaceStateError';
  }
}

export class ObjectNotFoundError extends Error {
  readonly code = OBJECT_NOT_FOUND_CODE;

  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
  }
}

export function isObjectNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (err instanceof ObjectNotFoundError) return true;
  if ((err as { code?: unknown }).code === OBJECT_NOT_FOUND_CODE) return true;
  if ((err as { name?: unknown }).name === 'ObjectNotFoundError') return true;
  const cause = (err as { cause?: unknown }).cause;
  return cause ? isObjectNotFoundError(cause) : false;
}
