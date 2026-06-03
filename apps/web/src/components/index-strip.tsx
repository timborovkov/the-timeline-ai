import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface IndexSegment {
  /** Optional dim label (e.g. "total", "team"). */
  label?: ReactNode;
  /** The main value (e.g. "2,847", "acme"). */
  value: ReactNode;
  /** Render the value in signal color (for highlight/live counts). */
  signal?: boolean;
  /** Render the value in danger color (overdue, error). */
  danger?: boolean;
}

interface IndexStripProps {
  /** The first segment renders as the page H1; subsequent segments are metadata. */
  segments: IndexSegment[];
  /** Optional trailing element (filter button, etc.) — right-aligned. */
  trailing?: ReactNode;
  children?: ReactNode;
  /** Plain-language summary for screen readers (replaces the shouty mono text). */
  srLabel: string;
  /** Optional id for the h1, useful for aria-labelledby on the page. */
  titleId?: string;
  className?: string;
}

function segmentKey(seg: IndexSegment): string {
  return [seg.label, seg.value, seg.signal ? 'signal' : '', seg.danger ? 'danger' : '']
    .map((part) => (typeof part === 'string' || typeof part === 'number' ? String(part) : 'node'))
    .join(':');
}

/**
 * The mono uppercase metadata one-liner that opens every list/feed/board.
 * Replaces decorative eyebrow + title + subtitle stacks.
 *
 * `segments[0]` is treated as the page's <h1>. The rest render as metadata.
 */
export function IndexStrip({
  segments,
  trailing,
  children,
  srLabel,
  titleId,
  className,
}: IndexStripProps) {
  const title = segments[0];
  if (!title) {
    throw new Error('IndexStrip requires at least one segment');
  }
  const rest = segments.slice(1);

  return (
    <header
      aria-label={srLabel}
      className={cn(
        'flex flex-wrap items-baseline gap-x-4 gap-y-1.5 border-y border-border py-3',
        'font-mono text-xs uppercase tracking-[0.12em] text-fg-muted',
        className,
      )}
    >
      <h1 id={titleId} className="m-0 text-xs font-normal uppercase tracking-[0.12em] text-fg">
        <span aria-hidden="true">{title.value}</span>
        <span className="sr-only">{srLabel}</span>
      </h1>
      {rest.map((seg) => (
        <span
          key={segmentKey(seg)}
          aria-hidden="true"
          className="inline-flex items-baseline gap-1.5"
        >
          {seg.label ? <span className="text-fg-dim">{seg.label}</span> : null}
          <span className={cn('text-fg', seg.signal && 'text-signal', seg.danger && 'text-danger')}>
            {seg.value}
          </span>
        </span>
      ))}
      {(trailing ?? children) ? (
        <span className="ml-auto text-fg-dim">{trailing ?? children}</span>
      ) : null}
    </header>
  );
}
