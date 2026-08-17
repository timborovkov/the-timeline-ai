import { useSyncExternalStore } from 'react';

function unsubscribeHydrated(): void {
  return undefined;
}

function subscribeHydrated(): () => void {
  return unsubscribeHydrated;
}

export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeHydrated,
    () => true,
    () => false,
  );
}
