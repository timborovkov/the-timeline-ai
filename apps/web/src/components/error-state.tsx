'use client';

import { AlertTriangle, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface Props {
  title?: string;
  description?: string;
  error?: Error & { digest?: string };
  reset?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'An unexpected error occurred while loading this view.',
  error,
  reset,
}: Props) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-4 rounded-sm border border-danger/30 bg-bg px-6 py-12 text-center"
    >
      <span
        aria-hidden="true"
        className="grid size-9 place-items-center rounded-sm border border-danger/30 text-danger"
      >
        <AlertTriangle className="size-5" />
      </span>
      <div className="space-y-1">
        <h2 className="text-base font-medium text-fg">{title}</h2>
        <p className="text-sm text-fg-muted">{description}</p>
        {error?.digest ? (
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
            ref: {error.digest}
          </p>
        ) : null}
      </div>
      {reset ? (
        <Button type="button" variant="outline" size="sm" onClick={() => reset()} className="gap-2">
          <RotateCw className="size-3.5" />
          Try again
        </Button>
      ) : null}
    </div>
  );
}
