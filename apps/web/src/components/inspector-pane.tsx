'use client';

import { PanelRightClose, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { useInspector } from '@/components/inspector-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The persistent right-pane primitive. Mounted once in the shell.
 * Reads from InspectorContext; renders nothing when no content is active.
 */
export function InspectorPane() {
  const inspector = useInspector();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (inspector.open) closeRef.current?.focus();
  }, [inspector.open, inspector.content?.id]);

  if (!inspector.open || !inspector.content) return null;

  const { id, kind, render } = inspector.content;

  return (
    <aside
      id="inspector-pane"
      role="dialog"
      aria-label={`Inspector for ${id}`}
      aria-labelledby="inspector-title"
      className={cn(
        'hidden w-80 shrink-0 border-l border-border bg-surface lg:flex lg:flex-col',
      )}
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-baseline gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
          <span>{kind}</span>
          <span className="text-fg-dim">·</span>
          <span id="inspector-title" className="text-signal">
            [{id}]
          </span>
        </div>
        <Button
          ref={closeRef}
          variant="ghost"
          size="icon"
          aria-label="Close inspector"
          onClick={inspector.hide}
          className="size-7"
        >
          <X className="size-3.5" />
        </Button>
      </header>
      <div
        className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed text-fg-muted"
        aria-live="polite"
      >
        {render()}
      </div>
    </aside>
  );
}

/**
 * <InspectorPane.Field /> — key/value row for use inside an inspector render.
 */
export function InspectorField({
  k,
  children,
}: {
  k: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[11ch_1fr] gap-x-3 py-1">
      <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
        {k}
      </dt>
      <dd className="m-0 text-fg">{children}</dd>
    </div>
  );
}

/**
 * <InspectorPane.Quote /> — source quote block with signal-color left border.
 * Renders in Switzer (not mono) since this is human-readable prose.
 */
export function InspectorQuote({ children }: { children: ReactNode }) {
  return (
    <blockquote className="mt-4 border-l-2 border-signal bg-bg p-3 font-sans text-sm leading-snug text-fg">
      {children}
    </blockquote>
  );
}

/**
 * Toggle button for the inspector — used in the top bar / command bar.
 */
export function InspectorToggle({ className }: { className?: string }) {
  const inspector = useInspector();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={inspector.open ? 'Close inspector' : 'Open inspector'}
      aria-pressed={inspector.open}
      onClick={inspector.toggle}
      className={cn('size-8', className)}
    >
      <PanelRightClose className="size-4" />
    </Button>
  );
}
