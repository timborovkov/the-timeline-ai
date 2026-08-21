'use client';

import { useEffect } from 'react';

import styles from '@/app/(landing)/home.module.css';

export function HomeMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-home-root]');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motionReadyClass = styles.motionReady;
    const visibleClass = styles.visible;

    if (!root || !motionReadyClass || !visibleClass || !('IntersectionObserver' in window)) return;

    const setFlowMotion = (diagram: HTMLElement, isActive: boolean, restart = false) => {
      for (const svg of diagram.querySelectorAll<SVGSVGElement>('[data-flow-motion]')) {
        if (isActive) {
          if (restart && typeof svg.setCurrentTime === 'function') svg.setCurrentTime(0);
          if (typeof svg.unpauseAnimations === 'function') svg.unpauseAnimations();
        } else if (typeof svg.pauseAnimations === 'function') {
          svg.pauseAnimations();
        }
      }
    };

    let disposeMotion = () => undefined;

    const startMotion = () => {
      if (reduceMotion.matches) {
        root.classList.remove(motionReadyClass);
        for (const diagram of root.querySelectorAll<HTMLElement>('[data-home-diagram]')) {
          diagram.classList.remove(visibleClass);
          setFlowMotion(diagram, false);
        }
        return;
      }

      root.classList.add(motionReadyClass);

      const revealNodes = [...root.querySelectorAll<HTMLElement>('[data-home-reveal]')];
      const activeNodes = [...root.querySelectorAll<HTMLElement>('[data-home-diagram]')];
      for (const node of activeNodes) setFlowMotion(node, false);

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
            const diagram = entry.target as HTMLElement;
            const wasVisible = diagram.classList.contains(visibleClass);
            diagram.classList.toggle(visibleClass, entry.isIntersecting);
            setFlowMotion(diagram, entry.isIntersecting, entry.isIntersecting && !wasVisible);
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

      disposeMotion = () => {
        revealObserver.disconnect();
        activeObserver.disconnect();
        window.removeEventListener('scroll', requestProgress);
        window.removeEventListener('resize', requestProgress);
        if (frame) window.cancelAnimationFrame(frame);
        for (const node of activeNodes) {
          node.classList.remove(visibleClass);
          setFlowMotion(node, false);
        }
        root.classList.remove(motionReadyClass);
        root.style.removeProperty('--home-progress');
      };
    };

    const restartForPreference = () => {
      disposeMotion();
      disposeMotion = () => undefined;
      startMotion();
    };

    reduceMotion.addEventListener('change', restartForPreference);
    startMotion();

    return () => {
      reduceMotion.removeEventListener('change', restartForPreference);
      disposeMotion();
    };
  }, []);

  return null;
}
