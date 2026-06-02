'use client';

import { PanelRightClose, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

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
        'sticky top-0 hidden h-screen w-96 shrink-0 self-start border-l border-border bg-surface lg:flex lg:flex-col',
      )}
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex min-w-0 items-baseline gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
          <span className="shrink-0">{kind}</span>
          <span className="shrink-0 text-fg-dim">·</span>
          <span id="inspector-title" title={id} className="min-w-0 truncate text-signal">
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
 * Toggle button for the inspector — used in the top bar / command bar.
 * Hidden below the `lg` breakpoint to match {@link InspectorPane}'s own
 * visibility: tapping a chip on mobile still routes through the
 * provider (so the state stays consistent for when the user resizes
 * up), but there's no visible pane to toggle so the button would be
 * misleading.
 */
export function InspectorToggle({ className }: { className?: string }) {
  const inspector = useInspector();
  // No content yet → nothing to toggle into. Disable the button rather
  // than flipping `open` to true with an empty pane, which would leave
  // the toggle showing pressed/closed-label with no visible UI change.
  const disabled = !inspector.content;
  const label = disabled
    ? 'No source selected yet'
    : inspector.open
      ? 'Close inspector'
      : 'Open inspector';
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={inspector.open}
      disabled={disabled}
      onClick={inspector.toggle}
      className={cn('hidden size-8 lg:inline-flex', className)}
    >
      <PanelRightClose className="size-4" />
    </Button>
  );
}
