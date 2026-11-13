'use client';

import { useRouter } from 'next/navigation';
import { useRef, type ReactNode } from 'react';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

export function ObjectPeekFrame({
  children,
  title,
  closeHref,
}: {
  children: ReactNode;
  title: string;
  closeHref: string;
}) {
  const router = useRouter();
  const contentRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) router.push(closeHref, { scroll: false });
      }}
    >
      <SheetContent
        showCloseButton={false}
        ref={contentRef}
        onOpenAutoFocus={(event) => {
          restoreFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          const close = contentRef.current?.querySelector<HTMLElement>('[data-peek-close]');
          if (close) {
            event.preventDefault();
            close.focus({ preventScroll: true });
          }
        }}
        onCloseAutoFocus={(event) => {
          if (restoreFocusRef.current?.isConnected) {
            event.preventDefault();
            restoreFocusRef.current.focus({ preventScroll: true });
          }
        }}
        aria-describedby={undefined}
        className="max-w-2xl"
      >
        <SheetTitle asChild>
          <span className="sr-only">{title}</span>
        </SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
