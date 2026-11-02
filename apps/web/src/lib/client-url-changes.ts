type HistoryMethod = 'pushState' | 'replaceState';

const listeners = new Set<() => void>();

const URL_WATCH_INTERVAL_MS = 50;

let patched = false;
let originalPushState: History['pushState'] | null = null;
let originalReplaceState: History['replaceState'] | null = null;
let urlWatchTimer: number | null = null;
let currentUrl = '';

function navigationApi(): EventTarget | null {
  const navigation = Reflect.get(window, 'navigation');
  return navigation instanceof EventTarget ? navigation : null;
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function notifyIfUrlChanged(): void {
  const nextUrl = window.location.href;
  if (nextUrl === currentUrl) return;
  currentUrl = nextUrl;
  notify();
}

function syncUrlAndNotify(): void {
  currentUrl = window.location.href;
  notify();
}

function patchHistoryMethod(method: HistoryMethod, original: History['pushState']): void {
  window.history[method] = (...args: Parameters<History['pushState']>) => {
    original(...args);
    notifyIfUrlChanged();
  };
}

function patchHistory(): void {
  if (patched) return;
  originalPushState = window.history.pushState.bind(window.history);
  originalReplaceState = window.history.replaceState.bind(window.history);
  currentUrl = window.location.href;
  patchHistoryMethod('pushState', originalPushState);
  patchHistoryMethod('replaceState', originalReplaceState);
  window.addEventListener('popstate', syncUrlAndNotify);
  window.addEventListener('hashchange', syncUrlAndNotify);
  navigationApi()?.addEventListener('currententrychange', syncUrlAndNotify);
  urlWatchTimer = window.setInterval(notifyIfUrlChanged, URL_WATCH_INTERVAL_MS);
  patched = true;
}

function unpatchHistory(): void {
  if (!patched) return;
  if (urlWatchTimer !== null) {
    window.clearInterval(urlWatchTimer);
    urlWatchTimer = null;
  }
  if (originalPushState) window.history.pushState = originalPushState;
  if (originalReplaceState) window.history.replaceState = originalReplaceState;
  window.removeEventListener('popstate', syncUrlAndNotify);
  window.removeEventListener('hashchange', syncUrlAndNotify);
  navigationApi()?.removeEventListener('currententrychange', syncUrlAndNotify);
  originalPushState = null;
  originalReplaceState = null;
  patched = false;
}

/**
 * Subscribe to in-page URL changes, including App Router fragment-only
 * `router.push` which uses `history.pushState` and does not fire `hashchange`.
 *
 * Next.js also patches `history` and may restore native methods on remount,
 * which wipes a wrap. Hashchange, Navigation API `currententrychange`, and a
 * short `location.href` watch still notify in that case.
 */
export function subscribeToClientUrlChanges(onChange: () => void): () => void {
  patchHistory();
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) unpatchHistory();
  };
}
