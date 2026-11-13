'use client';

import * as React from 'react';
import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

function Sheet({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn('fixed inset-0 z-50 bg-black/30', className)}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  showCloseButton = true,
  closeLabel = 'Close',
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  closeLabel?: string;
}) {
  const openerRef = React.useRef<HTMLElement | null>(null);
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex h-dvh min-w-0 w-full max-w-3xl flex-col overflow-hidden border-l border-border bg-surface shadow-lg duration-120 outline-none',
          className,
        )}
        {...props}
        onOpenAutoFocus={(event) => {
          openerRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          onOpenAutoFocus?.(event);
          if (event.defaultPrevented) return;
          const panel = event.currentTarget;
          if (!(panel instanceof HTMLElement)) return;
          event.preventDefault();
          (panel.querySelector<HTMLElement>('[data-slot="sheet-close"]') ?? panel).focus({
            preventScroll: true,
          });
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (event.defaultPrevented) return;
          event.preventDefault();
          const target = openerRef.current?.isConnected
            ? openerRef.current
            : document.querySelector<HTMLElement>('[data-inspector-focus-fallback]');
          target?.focus({ preventScroll: true });
        }}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            data-slot="sheet-close"
            aria-label={closeLabel}
            className="absolute top-3 right-3 inline-flex size-9 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon className="size-4" />
            <span className="sr-only">{closeLabel}</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        'flex min-w-0 max-h-[40dvh] shrink-0 flex-col gap-2 overflow-y-auto overscroll-contain border-b border-border px-5 py-4 pr-16 [overflow-wrap:anywhere]',
        className,
      )}
      {...props}
    />
  );
}

function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-body"
      className={cn(
        'min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 [scrollbar-gutter:stable] [overflow-wrap:anywhere]',
        className,
      )}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        'min-w-0 whitespace-normal text-base font-semibold leading-6 tracking-tight text-fg [overflow-wrap:anywhere]',
        className,
      )}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm leading-6 text-fg-muted', className)}
      {...props}
    />
  );
}

export { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle };
