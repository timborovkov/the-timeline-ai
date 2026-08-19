import { Pin } from 'lucide-react';

import { cn } from '@/lib/utils';

export function PinnedGlyph({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      title="Pinned to Home"
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center text-signal',
        className,
      )}
    >
      <Pin className="size-3 fill-current" />
    </span>
  );
}
