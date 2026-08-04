'use client';

import { AlertTriangle, ChevronDown, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface InlineErrorProps {
  /** Human-readable message (from ux-errors mappers). */
  message: string;
  /** Optional raw error string for the collapsible Details section. */
  details?: string;
  /** Optional retry handler. Renders a "Try again" button when provided. */
  onRetry?: () => void;
  /** Optional retry button label. Defaults to "Try again". */
  retryLabel?: string;
  /** True while a retry is in flight; disables the button and shows "Retrying…". */
  retrying?: boolean;
  className?: string;
}

/**
 * Inline error banner for actionable errors. Replaces raw `res.text()` in
 * dialogs and label-only error chips. Shows a human sentence, an optional
 * "Try again" button bound to a retry handler, and a collapsible "Details"
 * for the raw error string so power users and logs lose nothing.
 *
 * Uses the danger token (the design system's single destructive hue), no
 * shadow, `rounded-sm`. Not a modal — sits inline where the error matters.
 */
export function InlineError({
  message,
  details,
  onRetry,
  retryLabel = 'Try again',
  retrying = false,
  className,
}: InlineErrorProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-2 rounded-sm border border-danger/40 bg-danger/10 p-3',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
        <p className="min-w-0 flex-1 text-sm text-danger">{message}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onRetry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={retrying}
            onClick={() => {
              onRetry();
            }}
            className="gap-1.5"
          >
            <RotateCw aria-hidden="true" className="size-3.5" />
            {retrying ? 'Retrying…' : retryLabel}
          </Button>
        ) : null}
        {details ? (
          <details className="group min-w-0 basis-full">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-xs text-fg-muted transition-colors marker:hidden hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
              <ChevronDown
                aria-hidden="true"
                className="size-3 transition-transform group-open:rotate-180"
              />
              Technical details
            </summary>
            <pre className="mt-2 max-w-full whitespace-pre-wrap break-words rounded-sm bg-bg/60 p-2 font-mono text-[11px] text-fg-muted">
              {details}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}
