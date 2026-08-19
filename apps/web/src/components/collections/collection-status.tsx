import {
  STATUS_TONE_CLASS,
  STATUS_TONE_ICON,
  statusTone,
  type StatusTone,
} from '@/components/collections/collection-status-tone';
import { statusLabel } from '@/lib/status-labels';
import { cn } from '@/lib/utils';

export function CollectionStatus({
  value,
  label = statusLabel(value),
  tone = statusTone(value),
  compact = false,
  showIcon = true,
  className,
}: {
  value: string;
  label?: string;
  tone?: StatusTone;
  compact?: boolean;
  showIcon?: boolean;
  className?: string;
}) {
  const Icon = STATUS_TONE_ICON[tone];
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center text-xs',
        showIcon ? 'gap-1.5' : 'gap-0',
        STATUS_TONE_CLASS[tone],
        className,
      )}
    >
      {showIcon ? <Icon aria-hidden="true" className="size-3.5 shrink-0" /> : null}
      <span className={cn('truncate', compact && 'sr-only')}>{label}</span>
    </span>
  );
}
