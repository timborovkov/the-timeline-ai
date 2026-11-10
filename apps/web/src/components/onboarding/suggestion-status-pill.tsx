import { cn } from '@/lib/utils';

export function SuggestionStatusPill({
  status,
}: {
  status: 'pending' | 'accepted' | 'rejected' | 'updated';
}) {
  const label =
    status === 'accepted'
      ? 'Accepted'
      : status === 'rejected'
        ? 'Rejected'
        : status === 'updated'
          ? 'Updated · needs your approval'
          : 'Suggested · needs your approval';
  const tone = status === 'accepted' ? 'success' : status === 'rejected' ? 'neutral' : 'review';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs',
        tone === 'review' && 'bg-review-soft text-review',
        tone === 'success' && 'bg-surface-2 text-success',
        tone === 'neutral' && 'bg-surface-2 text-fg-dim',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          tone === 'review' && 'bg-review',
          tone === 'success' && 'bg-success',
          tone === 'neutral' && 'bg-fg-dim',
        )}
      />
      {label}
    </span>
  );
}
