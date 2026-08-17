'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

function restoreFocusAfterSave(
  trigger: HTMLButtonElement | null,
  pending: boolean,
  error: string | null | undefined,
  wasPendingRef: RefObject<boolean>,
  previousErrorRef: RefObject<string | null | undefined>,
): void {
  const completedSave = wasPendingRef.current && !pending;
  const receivedError = Boolean(error && error !== previousErrorRef.current);
  if (completedSave || receivedError) {
    trigger?.focus();
  }
  wasPendingRef.current = pending;
  previousErrorRef.current = error;
}

export function EditableMetadata({
  label,
  value,
  editor,
  pending = false,
  disabled = false,
  error,
  className,
  triggerRef,
}: {
  label: string;
  value: ReactNode;
  editor: ReactNode;
  pending?: boolean;
  disabled?: boolean;
  error?: string | null;
  className?: string;
  triggerRef?: (node: HTMLButtonElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const internalTriggerRef = useRef<HTMLButtonElement>(null);
  const wasPendingRef = useRef(false);
  const previousErrorRef = useRef<string | null | undefined>(undefined);
  const errorId = `${label.replaceAll(/\s+/g, '-').toLowerCase()}-error`;

  // react-doctor-disable-next-line react-doctor/no-event-handler -- Focus restoration is keyed to parent pending/error, not a local click.
  useEffect(() => {
    restoreFocusAfterSave(
      internalTriggerRef.current,
      pending,
      error,
      wasPendingRef,
      previousErrorRef,
    );
  }, [error, pending]);

  return (
    <span className="relative inline-flex min-w-0 flex-col">
      <Popover key={pending ? 'pending' : 'idle'} open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            ref={(node) => {
              internalTriggerRef.current = node;
              triggerRef?.(node);
            }}
            type="button"
            aria-label={label}
            aria-describedby={error ? errorId : undefined}
            disabled={disabled || pending}
            className={cn(
              'inline-flex min-h-10 min-w-0 items-center gap-1.5 rounded-sm px-2 text-xs text-fg-muted transition-[background-color,color,transform] duration-150 hover:bg-surface-2 hover:text-fg active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none motion-reduce:active:scale-100',
              error && 'text-danger',
              className,
            )}
          >
            {pending ? (
              <Loader2
                aria-hidden="true"
                className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
              />
            ) : null}
            <span className="min-w-0 truncate">{value}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent role="dialog" aria-label={label} className="min-w-52 p-2">
          {editor}
        </PopoverContent>
      </Popover>
      {error ? (
        <span
          id={errorId}
          role="alert"
          className="absolute left-2 top-full z-10 whitespace-nowrap text-[10px] text-danger"
        >
          {error}
        </span>
      ) : null}
    </span>
  );
}
