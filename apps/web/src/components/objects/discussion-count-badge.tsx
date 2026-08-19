import { MessageSquare } from 'lucide-react';

import { cn } from '@/lib/utils';

export function DiscussionCountBadge({ count, className }: { count?: number; className?: string }) {
  if (!count || count < 1) return null;
  return (
    <span
      className={cn('inline-flex items-center gap-0.5 text-xs tabular-nums text-fg-dim', className)}
      title={`${count} discussion ${count === 1 ? 'comment' : 'comments'}`}
    >
      <MessageSquare className="size-3" aria-hidden="true" />
      <span>{count}</span>
    </span>
  );
}
