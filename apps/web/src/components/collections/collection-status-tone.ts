export type StatusTone = 'neutral' | 'progress' | 'review' | 'success' | 'danger';

const PROGRESS = new Set(['active', 'doing', 'in_progress', 'in progress', 'processing']);
const REVIEW = new Set(['proposed', 'pending', 'review', 'in_review', 'in review', 'suggested']);
const SUCCESS = new Set(['done', 'shipped', 'complete', 'completed', 'accepted', 'ready']);
const DANGER = new Set(['blocked', 'failed', 'overdue', 'rejected']);

export function statusTone(value: string): StatusTone {
  const normalized = value.trim().toLowerCase();
  if (DANGER.has(normalized)) return 'danger';
  if (SUCCESS.has(normalized)) return 'success';
  if (REVIEW.has(normalized)) return 'review';
  if (PROGRESS.has(normalized)) return 'progress';
  return 'neutral';
}

export function priorityTone(priority: number | null | undefined): StatusTone {
  if (priority === 1) return 'danger';
  if (priority === 2) return 'progress';
  return 'neutral';
}

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'text-fg-dim',
  progress: 'text-status-progress',
  review: 'text-status-review',
  success: 'text-status-success',
  danger: 'text-danger',
};

export function statusToneClass(tone: StatusTone): string {
  return TONE_CLASS[tone];
}

export { TONE_CLASS };
