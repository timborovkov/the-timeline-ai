'use client';

import { useEffect, useRef } from 'react';

import type { ComponentProps } from 'react';

/** Keeps the whole explanation visible; only decorative motion waits for visibility. */
export function MotionFigure(props: ComponentProps<'figure'>) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const figure = ref.current;
    if (
      !figure ||
      !('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        figure.dataset.motionEntered = 'true';
        observer.disconnect();
      },
      { threshold: 0.24 },
    );
    observer.observe(figure);
    return () => {
      observer.disconnect();
    };
  }, []);

  return <figure {...props} ref={ref} />;
}
