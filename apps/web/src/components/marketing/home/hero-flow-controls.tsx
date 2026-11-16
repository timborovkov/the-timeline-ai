'use client';

import { Pause, Play } from 'lucide-react';
import { useState } from 'react';

import styles from '@/app/(landing)/home.module.css';

export function HeroFlowControls() {
  const [paused, setPaused] = useState(false);
  return (
    <button
      type="button"
      className={styles.heroFlowControl}
      onClick={(event) => {
        const figure = event.currentTarget.closest('figure');
        if (!figure) return;
        const next = !paused;
        figure.dataset.motionPaused = String(next);
        const svg = figure.querySelector<SVGSVGElement>('[data-flow-motion]');
        if (next) svg?.pauseAnimations();
        else if (!document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
          svg?.unpauseAnimations();
        setPaused(next);
      }}
    >
      {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
      {paused ? 'Play animation' : 'Pause animation'}
    </button>
  );
}
