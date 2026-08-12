'use client';

import { useEffect } from 'react';

import styles from '@/app/(landing)/home.module.css';

export function HomeMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-home-root]');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motionReadyClass = styles.motionReady;
    const visibleClass = styles.visible;

    if (!root || !motionReadyClass || !visibleClass || reduceMotion.matches) return;

    root.classList.add(motionReadyClass);

    const revealNodes = [...root.querySelectorAll<HTMLElement>('[data-home-reveal]')];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add(visibleClass);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    );

    for (const node of revealNodes) observer.observe(node);

    let frame = 0;
    const updateProgress = () => {
      frame = 0;
      const distance = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = distance > 0 ? Math.min(1, Math.max(0, window.scrollY / distance)) : 0;
      root.style.setProperty('--home-progress', String(ratio));
    };
    const requestProgress = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateProgress);
    };

    window.addEventListener('scroll', requestProgress, { passive: true });
    window.addEventListener('resize', requestProgress);
    updateProgress();

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', requestProgress);
      window.removeEventListener('resize', requestProgress);
      if (frame) window.cancelAnimationFrame(frame);
      root.classList.remove(motionReadyClass);
      root.style.removeProperty('--home-progress');
    };
  }, []);

  return null;
}
