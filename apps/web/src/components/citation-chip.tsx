'use client';

import type { ReactNode } from 'react';

import { useInspector } from '@/components/inspector-context';
import { cn } from '@/lib/utils';

interface CitationChipProps {
  /** Short ID without brackets, e.g. "c:1923" or "obj:DEAL-204". */
  id: string;
  /** Source kind, e.g. "Email", "Voice", "Object". Used for SR text. */
  source?: string;
  /** Rich content to render inside the inspector when this chip is opened. */
  render?: () => ReactNode;
  /** Visual variant. `default` = signal-tinted; `muted` = grayscale (stale / secondary). */
  variant?: 'default' | 'muted';
  className?: string;
}

/**
 * The product's primary visual symbol — a monospace [c:ID] chip in signal
 * color that opens the right inspector pane with the source on click.
 */
export function CitationChip({
  id,
  source,
  render,
  variant = 'default',
  className,
}: CitationChipProps) {
  const inspector = useInspector();
  const label = source
    ? `Citation ${id}, source ${source}. Press Enter to view source.`
    : `Citation ${id}. Press Enter to view source.`;

  const handle = () => {
    inspector.show({
      id,
      kind: source?.toUpperCase() ?? 'SOURCE',
      render:
        render ??
        (() => (
          <p className="text-fg-muted">
            No detail loaded for{' '}
            <span className="font-mono text-signal">[{id}]</span> yet.
          </p>
        )),
    });
  };

  return (
    <button
      type="button"
      onClick={handle}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={inspector.open && inspector.content?.id === id}
      aria-controls="inspector-pane"
      className={cn(
        'inline-flex items-center align-baseline font-mono text-[0.9em] leading-none',
        'rounded-sm px-1 py-0.5 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
        variant === 'default' &&
          'border border-signal/30 bg-signal-soft text-signal hover:bg-signal/25',
        variant === 'muted' &&
          'border border-border text-fg-muted hover:bg-surface-2',
        className,
      )}
    >
      <span aria-hidden="true">[{id}]</span>
    </button>
  );
}
