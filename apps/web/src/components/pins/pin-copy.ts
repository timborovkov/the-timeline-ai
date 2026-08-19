export function pinControlLabel(pinned: boolean, pending = false): string {
  if (pending) return pinned ? 'Saving pin…' : 'Saving unpin…';
  return pinned ? 'Unpin from Home' : 'Pin to Home';
}

export function pinNotifyCopy(nextPinned: boolean): {
  loading: string;
  success: string;
  error: string;
} {
  return nextPinned
    ? { loading: 'Pinning…', success: 'Pinned to Home', error: 'Couldn’t pin item' }
    : { loading: 'Unpinning…', success: 'Unpinned', error: 'Couldn’t unpin item' };
}
