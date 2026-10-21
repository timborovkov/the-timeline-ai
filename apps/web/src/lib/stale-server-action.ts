const STALE_SERVER_ACTION_RELOAD_KEY = 'timeline:stale-server-action-reloaded';

export function isStaleServerActionError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object' && 'name' in error && error.name === 'UnrecognizedActionError') {
    return true;
  }
  const message =
    typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? error.message
      : '';
  return /server action .* was not found on the server/i.test(message);
}

/**
 * Recover from a stale client bundle after a deployment by reloading once per tab.
 * Returns true when a reload was triggered.
 */
export function recoverFromStaleServerAction(error: unknown): boolean {
  if (!isStaleServerActionError(error)) return false;
  if (typeof window === 'undefined') return false;
  if (sessionStorage.getItem(STALE_SERVER_ACTION_RELOAD_KEY) === '1') return false;

  sessionStorage.setItem(STALE_SERVER_ACTION_RELOAD_KEY, '1');
  window.location.reload();
  return true;
}

export function reloadForStaleServerAction(): void {
  if (typeof window === 'undefined') return;
  window.location.reload();
}

export function resetStaleServerActionReloadGuardForTests(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(STALE_SERVER_ACTION_RELOAD_KEY);
}
