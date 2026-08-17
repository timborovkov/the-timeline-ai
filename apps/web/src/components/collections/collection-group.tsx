'use client';

import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';

import type { ReactNode } from 'react';

import { statusToneClass, type StatusTone } from '@/components/collections/collection-status';
import { cn } from '@/lib/utils';

export function CollectionGroup({
  title,
  count,
  tone = 'neutral',
  icon,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  count: number;
  tone?: StatusTone;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(true);
  const contentId = useId();
  return (
    <section className={cn('min-w-0', className)}>
      <div className="flex min-h-10 items-center gap-1 border-y border-border bg-surface/70 px-2 sm:px-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => {
            setOpen((current) => !current);
          }}
          className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-sm text-left text-xs font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-3.5 shrink-0 text-fg-dim transition-transform duration-150 motion-reduce:transition-none',
              !open && '-rotate-90',
            )}
          />
          <span className={statusToneClass(tone)}>{icon}</span>
          <span className="truncate">{title}</span>
          <span className="font-mono tabular-nums text-fg-dim">{count}</span>
        </button>
        {actions ? <div className="flex min-h-10 items-center">{actions}</div> : null}
      </div>
      <div id={contentId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
