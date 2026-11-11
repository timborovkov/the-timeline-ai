'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** Date bands follow the toolbar when its controls wrap or filters expand. */
export function TimelineToolbarFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const toolbar = ref.current;
    const frame = toolbar?.closest<HTMLElement>('[data-app-width="collection"]');
    if (!toolbar || !frame) return;
    const measure = () => {
      frame.style.setProperty(
        '--timeline-toolbar-height',
        `${toolbar.getBoundingClientRect().height}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    return () => {
      observer.disconnect();
      frame.style.removeProperty('--timeline-toolbar-height');
    };
  }, []);
  return (
    <div
      ref={ref}
      data-slot="collection-sticky-band"
      className="sticky top-0 z-20 -mx-4 bg-bg px-4 md:-mx-8 md:px-8"
    >
      {children}
    </div>
  );
}
