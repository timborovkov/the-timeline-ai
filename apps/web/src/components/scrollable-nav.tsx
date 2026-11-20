'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function ScrollableNav({
  label,
  cue,
  activeKey,
  className,
  itemsClassName,
  children,
}: {
  label: string;
  cue: string;
  activeKey: string | undefined;
  className?: string;
  itemsClassName?: string;
  children: ReactNode;
}) {
  const navRef = useRef<HTMLElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const nav = navRef.current;
    const items = itemsRef.current;
    if (!nav || !items) return;

    const measure = () => {
      const hasOverflow = nav.scrollWidth > nav.clientWidth;
      setOverflows(hasOverflow);
      if (!hasOverflow) return;

      const active = items.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) return;
      const item = active.getBoundingClientRect();
      const strip = nav.getBoundingClientRect();
      nav.scrollLeft += item.left - strip.left - (nav.clientWidth - item.width) / 2;
    };

    const frame = requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(nav);
    observer?.observe(items);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [activeKey]);

  return (
    <>
      <nav
        ref={navRef}
        aria-label={label}
        className={cn('max-w-full overflow-x-auto', className)}
        onFocus={(event) => {
          const nav = event.currentTarget;
          if (nav.scrollWidth <= nav.clientWidth) return;

          const item = event.target.getBoundingClientRect();
          const strip = nav.getBoundingClientRect();
          const clippedStart = Math.min(0, item.left - strip.left);
          const clippedEnd = Math.max(0, item.right - strip.left - nav.clientWidth);
          nav.scrollLeft += clippedStart + clippedEnd;
        }}
      >
        <div ref={itemsRef} className={cn('flex min-w-max gap-1', itemsClassName)}>
          {children}
        </div>
      </nav>
      {overflows && (
        <p aria-hidden="true" className="py-1 text-xs text-fg-dim">
          {cue}
        </p>
      )}
    </>
  );
}
