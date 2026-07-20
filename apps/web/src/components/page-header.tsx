import Link from 'next/link';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface PageHeaderMetadataBase {
  /** Optional dim label (e.g. "team", "members"). */
  label?: ReactNode;
  /** The main value (e.g. "acme", 12). */
  value: ReactNode;
  /** Render the value in signal color (highlight/live counts). */
  signal?: boolean;
  /** Render the value in danger color (overdue, error). */
  danger?: boolean;
  /** Use Commit Mono for a timestamp, count, citation, shortcut, or public key. */
  mono?: boolean;
}

export type PageHeaderMetadata = PageHeaderMetadataBase &
  (
    | {
        /** Destination that makes the whole metadata segment actionable. */
        href: string;
        /** Accessible purpose required for linked metadata. */
        ariaLabel: string;
      }
    | { href?: never; ariaLabel?: never }
  );

function metadataKey(seg: PageHeaderMetadata, index: number): string {
  return [
    index,
    seg.label,
    seg.value,
    seg.signal ? 'signal' : '',
    seg.danger ? 'danger' : '',
    seg.mono ? 'mono' : '',
    seg.href ?? '',
  ]
    .map((part) => (typeof part === 'string' || typeof part === 'number' ? String(part) : 'node'))
    .join(':');
}

interface PageHeaderProps {
  /** The page <h1>. Sentence-case, Switzer 600. One per page. */
  title: ReactNode;
  /** Optional one-line description below the title. */
  subtitle?: ReactNode;
  /** Optional quiet metadata row. Values opt into mono individually. */
  metadata?: PageHeaderMetadata[];
  /** Optional leading element (breadcrumb / back link), left of the title. */
  leading?: ReactNode;
  /** Optional trailing actions, right-aligned. */
  trailing?: ReactNode;
  /** Optional id for the h1 (useful for aria-labelledby). */
  titleId?: string;
  /** Plain-language summary of the metadata for screen readers. The
   * visible metadata row is hidden to avoid duplicate announcements. */
  srLabel?: string;
  className?: string;
}

/**
 * Standard page header for non-operational surfaces (Home, Sources, Team,
 * Connections, Calendar, etc.). Replaces the mono uppercase `IndexStrip`
 * on those pages: the title is a readable Switzer H1, while counts, IDs,
 * and status stay mono in a metadata strip below.
 *
 * Timeline and explicit audit/operator surfaces may keep `IndexStrip`.
 */
export function PageHeader({
  title,
  subtitle,
  metadata,
  leading,
  trailing,
  titleId,
  srLabel,
  className,
}: PageHeaderProps) {
  const metadataList = metadata ?? [];
  const hasMetadata = metadataList.length > 0;
  return (
    <header className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          {leading ? <div className="text-fg-dim">{leading}</div> : null}
          <h1 id={titleId} className="m-0 text-2xl font-semibold tracking-tight text-fg">
            {title}
          </h1>
          {subtitle ? <p className="m-0 text-sm text-fg-muted">{subtitle}</p> : null}
        </div>
        {trailing ? <div className="flex items-center gap-2">{trailing}</div> : null}
      </div>
      {hasMetadata ? (
        <dl
          aria-hidden={srLabel ? true : undefined}
          className="m-0 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-fg-muted"
        >
          {metadataList.map((seg, index) => (
            <div
              key={metadataKey(seg, index)}
              className={cn(
                'relative inline-flex items-baseline gap-1.5',
                seg.href && 'min-h-10 min-w-10 items-center px-2 -mx-2',
              )}
            >
              {seg.label ? <dt className="m-0 text-fg-dim">{seg.label}</dt> : null}
              <dd
                className={cn(
                  'm-0 text-fg',
                  seg.mono && 'font-mono tabular-nums',
                  seg.signal && 'text-signal',
                  seg.danger && 'text-danger',
                )}
              >
                {seg.value}
              </dd>
              {seg.href ? (
                <Link
                  href={seg.href}
                  aria-label={seg.ariaLabel}
                  className="absolute inset-0 rounded-sm outline-none hover:bg-surface/50 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
                />
              ) : null}
            </div>
          ))}
        </dl>
      ) : null}
      {srLabel ? <span className="sr-only">{srLabel}</span> : null}
    </header>
  );
}
