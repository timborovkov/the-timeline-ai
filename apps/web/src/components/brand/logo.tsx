import { cn } from '@/lib/utils';

/**
 * The Timeline mark — 4 stacked index-strip rows with a single lime
 * citation chip on the third row. The mark IS the product story:
 * timeline entries + a cited row. Uses `currentColor` for the bars so
 * it adapts to light/dark theme; the chip stays in `--signal`.
 *
 * viewBox is 48×48 to make it pixel-perfect at common icon sizes
 * (16, 24, 32, 48, 96).
 */
export function Logo({
  className,
  title = 'The Timeline',
  ariaHidden = false,
}: {
  className?: string;
  title?: string;
  ariaHidden?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      role={ariaHidden ? undefined : 'img'}
      aria-label={ariaHidden ? undefined : title}
      aria-hidden={ariaHidden || undefined}
      focusable="false"
    >
      {!ariaHidden && <title>{title}</title>}
      {/* Row 1 — long */}
      <rect x="0" y="6" width="38" height="6" fill="currentColor" />
      {/* Row 2 — short */}
      <rect x="0" y="16" width="27" height="6" fill="currentColor" />
      {/* Row 3 — long, cited */}
      <rect x="0" y="26" width="38" height="6" fill="currentColor" />
      {/* Citation chip — signal lime */}
      <rect x="42" y="26" width="6" height="6" fill="var(--signal)" />
      {/* Row 4 — medium */}
      <rect x="0" y="36" width="32" height="6" fill="currentColor" />
    </svg>
  );
}

/**
 * Wordmark composition: mark + "THE TIMELINE" in mono. Used in
 * top nav and footer. Pass `compact` for nav (smaller mark), default
 * size for footer/marketing.
 */
export function Wordmark({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Logo
        ariaHidden
        className={cn(compact ? 'h-4 w-4' : 'h-5 w-5', 'text-fg')}
      />
      <span className="font-mono text-xs font-bold uppercase tracking-[0.18em]">
        THE TIMELINE
      </span>
    </span>
  );
}
