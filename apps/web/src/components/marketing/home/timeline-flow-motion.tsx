'use client';

import { useEffect } from 'react';

import styles from '@/app/(landing)/home.module.css';

interface TimelineFlowMotionProps {
  readonly targetId: string;
}

export function TimelineFlowMotion({ targetId }: TimelineFlowMotionProps) {
  useEffect(() => {
    const root = document.getElementById(targetId);
    const motionReadyClass = styles.motionReady;
    const visibleClass = styles.visible;

    if (!root || !motionReadyClass || !visibleClass) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const steps = [...root.querySelectorAll<HTMLElement>('[data-flow-step]')];

    const setSvgMotion = (step: HTMLElement, isActive: boolean, restart = false) => {
      for (const svg of step.querySelectorAll<SVGSVGElement>('[data-flow-motion]')) {
        if (isActive) {
          if (restart && typeof svg.setCurrentTime === 'function') svg.setCurrentTime(0);
          if (typeof svg.unpauseAnimations === 'function') svg.unpauseAnimations();
        } else if (typeof svg.pauseAnimations === 'function') {
          svg.pauseAnimations();
        }
      }
    };

    const resetMotionState = () => {
      root.classList.remove(motionReadyClass);
      for (const step of steps) {
        step.classList.remove(visibleClass);
        setSvgMotion(step, false);
      }
    };

    let observer: IntersectionObserver | null = null;

    const startMotion = () => {
      observer?.disconnect();
      observer = null;
      resetMotionState();

      if (reduceMotion.matches) return;

      root.classList.add(motionReadyClass);
      observer =
        typeof window.IntersectionObserver === 'function'
          ? new IntersectionObserver(
              (entries) => {
                for (const entry of entries) {
                  const step = entry.target as HTMLElement;
                  const wasVisible = step.classList.contains(visibleClass);
                  step.classList.toggle(visibleClass, entry.isIntersecting);
                  setSvgMotion(step, entry.isIntersecting, entry.isIntersecting && !wasVisible);
                }
              },
              { rootMargin: '0px 0px -18% 0px', threshold: 0.18 },
            )
          : null;

      if (!observer) {
        for (const step of steps) {
          step.classList.add(visibleClass);
          setSvgMotion(step, true, true);
        }
        return;
      }

      for (const step of steps) {
        observer.observe(step);
      }
    };

    reduceMotion.addEventListener('change', startMotion);
    startMotion();

    return () => {
      observer?.disconnect();
      reduceMotion.removeEventListener('change', startMotion);
      resetMotionState();
    };
  }, [targetId]);

  return null;
}
