'use client';

interface BrowserResourceOptions<T> {
  initial: T;
  load(previous: T): Promise<T>;
  onChange?(value: T): void;
}

export function createBrowserResourceStore<T>({
  initial,
  load,
  onChange,
}: BrowserResourceOptions<T>) {
  let snapshot = initial;
  let inflight: Promise<T> | null = null;
  let generation = 0;
  let loaded = false;
  let currentPathname: string | null = null;
  let browserRefreshBound = false;
  const listeners = new Set<() => void>();

  function emit() {
    for (const listener of listeners) listener();
  }

  function refresh(): Promise<T> {
    if (inflight) return inflight;
    const requestGeneration = ++generation;
    const request = load(snapshot)
      .then((next) => {
        if (requestGeneration !== generation) return snapshot;
        snapshot = next;
        loaded = true;
        onChange?.(next);
        emit();
        return snapshot;
      })
      .finally(() => {
        // An older request cannot release a newer request's deduplication lock.
        if (requestGeneration === generation) inflight = null;
      });
    inflight = request;
    return request;
  }

  function ensureLoaded() {
    if (!loaded) void refresh();
  }

  function bindBrowserRefresh() {
    if (browserRefreshBound || typeof window === 'undefined') return;
    browserRefreshBound = true;
    const onVisible = () => {
      void refresh();
    };
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onVisible);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onVisible();
    });
  }

  function subscribeIdle(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    refresh,
    ensureLoaded,
    subscribeIdle,
    subscribe(listener: () => void): () => void {
      const unsubscribe = subscribeIdle(listener);
      bindBrowserRefresh();
      ensureLoaded();
      return unsubscribe;
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    reportPathname(pathname: string) {
      if (currentPathname === pathname) return;
      const first = currentPathname === null;
      currentPathname = pathname;
      if (!first) void refresh();
    },
    reset() {
      generation++;
      snapshot = initial;
      loaded = false;
      inflight = null;
      currentPathname = null;
      emit();
    },
    set(next: T) {
      generation++;
      snapshot = next;
      loaded = true;
      inflight = null;
      onChange?.(next);
      emit();
    },
  };
}
