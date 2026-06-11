export function canUseAppHistory(): boolean {
  if (typeof window === 'undefined') return false;
  const historyState = window.history.state as unknown;
  const nextHistoryIndex =
    historyState && typeof historyState === 'object' && 'idx' in historyState
      ? (historyState as { idx?: unknown }).idx
      : undefined;
  if (typeof nextHistoryIndex === 'number' && nextHistoryIndex > 0) return true;
  if (!document.referrer) return false;
  try {
    return (
      new URL(document.referrer).origin === window.location.origin && window.history.length > 1
    );
  } catch {
    return false;
  }
}

interface HistoryBackClick {
  altKey: boolean;
  button: number;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function shouldUseHistoryBackClick(event: HistoryBackClick): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    canUseAppHistory()
  );
}
