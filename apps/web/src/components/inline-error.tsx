'use client';

import { AlertTriangle, ChevronDown, RotateCw } from 'lucide-react';
import { useState } from 'react';

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
  const [showDetails, setShowDetails] = useState(false);
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
      <div className="flex items-center gap-2">
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
          <button
            type="button"
            onClick={() => {
              setShowDetails((v) => !v);
            }}
            className="inline-flex items-center gap-1 text-xs text-fg-muted transition-colors hover:text-fg"
            aria-expanded={showDetails}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn('size-3 transition-transform', showDetails && 'rotate-180')}
            />
            Details
          </button>
        ) : null}
      </div>
      {details && showDetails ? (
        <pre className="overflow-auto rounded-sm bg-bg/60 p-2 font-mono text-[11px] text-fg-muted">
          {details}
        </pre>
      ) : null}
    </div>
  );
}
