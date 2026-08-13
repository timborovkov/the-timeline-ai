'use client';

import { useEffect } from 'react';

import styles from '@/app/(landing)/home.module.css';

export function HomeMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-home-root]');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motionReadyClass = styles.motionReady;
    const visibleClass = styles.visible;

    if (
      !root ||
      !motionReadyClass ||
      !visibleClass ||
      reduceMotion.matches ||
      !('IntersectionObserver' in window)
    ) {
      return;
    }

    root.classList.add(motionReadyClass);

    const revealNodes = [...root.querySelectorAll<HTMLElement>('[data-home-reveal]')];
    const activeNodes = [
      ...root.querySelectorAll<HTMLElement>('[data-home-ambient], [data-home-diagram]'),
    ];
    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add(visibleClass);
          revealObserver.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    );
    const activeObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          entry.target.classList.toggle(visibleClass, entry.isIntersecting);
        }
      },
      { rootMargin: '-4% 0px -4% 0px', threshold: 0.06 },
    );

    for (const node of revealNodes) revealObserver.observe(node);
    for (const node of activeNodes) activeObserver.observe(node);

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
      revealObserver.disconnect();
      activeObserver.disconnect();
      window.removeEventListener('scroll', requestProgress);
      window.removeEventListener('resize', requestProgress);
      if (frame) window.cancelAnimationFrame(frame);
      root.classList.remove(motionReadyClass);
      root.style.removeProperty('--home-progress');
    };
  }, []);

  return null;
}
