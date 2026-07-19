const LABELS: Record<string, string> = {
  active: 'Active',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
  complete: 'Complete',
  completed: 'Completed',
  connected: 'Connected',
  disconnected: 'Disconnected',
  doing: 'In progress',
  done: 'Done',
  failed: 'Failed',
  in_progress: 'In progress',
  needs_attention: 'Needs attention',
  on_hold: 'On hold',
  overdue: 'Overdue',
  paused: 'Paused',
  pending: 'Pending',
  processing: 'Processing',
  ready: 'Ready',
  scheduled: 'Scheduled',
  shipped: 'Shipped',
  todo: 'To do',
};

export function statusLabel(status: string): string {
  const normalized = status.trim().toLowerCase();
  const fallback = normalized.replaceAll('_', ' ');
  return LABELS[normalized] ?? fallback.replace(/^\w/, (letter) => letter.toUpperCase());
}
