import { Pin } from 'lucide-react';

import { cn } from '@/lib/utils';

export function PinnedGlyph({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center text-signal',
        className,
      )}
    >
      <Pin className="size-3 fill-current" />
    </span>
  );
}
