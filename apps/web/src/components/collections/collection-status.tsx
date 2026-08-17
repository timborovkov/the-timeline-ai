import { Circle, CircleCheck, CircleDashed, CircleDot, CircleX } from 'lucide-react';

import type { ComponentType, SVGProps } from 'react';

import { statusLabel } from '@/lib/status-labels';
import { cn } from '@/lib/utils';

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

const TONE_ICON: Record<StatusTone, ComponentType<SVGProps<SVGSVGElement>>> = {
  neutral: Circle,
  progress: CircleDot,
  review: CircleDashed,
  success: CircleCheck,
  danger: CircleX,
};

export function CollectionStatus({
  value,
  label = statusLabel(value),
  tone = statusTone(value),
  compact = false,
  className,
}: {
  value: string;
  label?: string;
  tone?: StatusTone;
  compact?: boolean;
  className?: string;
}) {
  const Icon = TONE_ICON[tone];
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 text-xs',
        TONE_CLASS[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className={cn('truncate', compact && 'sr-only')}>{label}</span>
    </span>
  );
}

export function statusToneClass(tone: StatusTone): string {
  return TONE_CLASS[tone];
}
