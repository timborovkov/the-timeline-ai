'use client';

import { useRouter } from 'next/navigation';
import { useRef, useSyncExternalStore, type ReactNode } from 'react';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia('(min-width: 1280px)');
  media.addEventListener('change', onChange);
  return () => {
    media.removeEventListener('change', onChange);
  };
}
function desktopSnapshot(): boolean {
  return window.matchMedia('(min-width: 1280px)').matches;
}
function serverSnapshot(): boolean {
  return true;
}

export function ObjectPeekFrame({
  children,
  title,
  closeHref,
}: {
  children: ReactNode;
  title: string;
  closeHref: string;
}) {
  const desktop = useSyncExternalStore(subscribe, desktopSnapshot, serverSnapshot);
  const router = useRouter();
  const contentRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  if (desktop) return children;
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
            close.focus();
          }
        }}
        onCloseAutoFocus={(event) => {
          if (restoreFocusRef.current?.isConnected) {
            event.preventDefault();
            restoreFocusRef.current.focus();
          }
        }}
        aria-describedby={undefined}
        className="inset-x-0 top-auto bottom-0 h-[90dvh] max-w-none rounded-t-lg border-t bg-surface"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
