'use client';

import { useEffect, useRef } from 'react';

import type { ReactNode } from 'react';

import styles from '@/components/marketing/editorial/editorial.module.css';

export function ProvenanceReveal({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        container.dataset.revealed = 'true';
        observer.disconnect();
      },
      { threshold: 0.24 },
    );
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={containerRef} className={styles.provenanceReveal}>
      {children}
    </div>
  );
}
