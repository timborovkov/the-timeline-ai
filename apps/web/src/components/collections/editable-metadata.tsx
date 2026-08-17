'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import type { ReactNode } from 'react';

import {
  createCollectionSlot,
  readCollectionSlots,
} from '@/components/collections/collection-slot';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const EditableMetadataValue = createCollectionSlot('value');
const EditableMetadataEditor = createCollectionSlot('editor');

const METADATA_SLOTS = {
  value: EditableMetadataValue,
  editor: EditableMetadataEditor,
};

export function EditableMetadata({
  label,
  children,
  pending = false,
  disabled = false,
  error,
  className,
  triggerRef,
}: {
  label: string;
  children?: ReactNode;
  pending?: boolean;
  disabled?: boolean;
  error?: string | null;
  className?: string;
  triggerRef?: (node: HTMLButtonElement | null) => void;
}) {
  const slots = readCollectionSlots(children, METADATA_SLOTS);
  const [userOpen, setUserOpen] = useState(false);
  const internalTriggerRef = useRef<HTMLButtonElement>(null);
  const wasPendingRef = useRef(false);
  const previousErrorRef = useRef<string | null | undefined>(undefined);
  const errorId = useId();
  const open = userOpen && !pending && !disabled;

  // Restore focus after a parent-driven save finishes. pending/error are the
  // completion signals; there is no local event handler for that commit.
  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-event-handler -- Focus restoration is keyed to parent pending/error, not a local click.
    const completedSave = wasPendingRef.current && !pending;
    // react-doctor-disable-next-line react-doctor/no-event-handler -- Same parent pending/error completion signal.
    const receivedError = Boolean(error && error !== previousErrorRef.current);
    if (completedSave || receivedError) {
      internalTriggerRef.current?.focus();
    }
    wasPendingRef.current = pending;
    previousErrorRef.current = error;
  }, [error, pending]);

  return (
    <span className="relative inline-flex min-w-0 flex-col">
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (pending || disabled) {
            setUserOpen(false);
            return;
          }
          setUserOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <button
            ref={(node) => {
              internalTriggerRef.current = node;
              triggerRef?.(node);
            }}
            type="button"
            aria-label={label}
            aria-invalid={error ? true : undefined}
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
            <span className="min-w-0 truncate">{slots.value}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent role="dialog" aria-label={label} className="min-w-52 p-2">
          {slots.editor}
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

EditableMetadata.Value = EditableMetadataValue;
EditableMetadata.Editor = EditableMetadataEditor;
