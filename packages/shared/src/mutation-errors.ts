export class StaleWorkspaceStateError extends Error {
  constructor() {
    super('This item changed. Read its current state and request approval again.');
    this.name = 'StaleWorkspaceStateError';
  }
}
