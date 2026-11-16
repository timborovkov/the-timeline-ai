'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';

/** Preserve page state and scroll ownership while softening route replacement. */
export function AppPageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const previous = useRef(pathname);
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = element.current?.animate([{ opacity: 0.75 }, { opacity: 1 }], {
      duration: 120,
      easing: 'ease-out',
    });
    return () => animation?.cancel();
  }, [pathname]);
  return (
    <div
      ref={element}
      data-slot="app-page-container"
      data-work-page={
        /^\/app\/(work|objects|tasks|boards|calendar|digests|approvals)(\/|$)/.test(pathname) ||
        undefined
      }
      className="app-page-container mx-auto w-full min-w-0 max-w-6xl"
    >
      {children}
    </div>
  );
}
