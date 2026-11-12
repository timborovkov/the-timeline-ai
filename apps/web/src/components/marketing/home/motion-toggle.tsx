'use client';

import { Pause, Play } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';

import styles from '@/app/(landing)/home.module.css';

function subscribe(onChange: () => void) {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  preference.addEventListener('change', onChange);
  return () => {
    preference.removeEventListener('change', onChange);
  };
}

export function MotionToggle({ targetId }: { readonly targetId: string }) {
  const [paused, setPaused] = useState(false);
  const reducedMotion = useSyncExternalStore(
    subscribe,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => true,
  );
  const Icon = paused ? Play : Pause;

  return (
    <button
      type="button"
      className={styles.motionToggle}
      aria-controls={targetId}
      disabled={reducedMotion}
      onClick={() => {
        const root = document.getElementById(targetId);
        if (!root) return;
        const nextPaused = !paused;
        root.dataset.motionPaused = String(nextPaused);
        root.dispatchEvent(new Event('flow-motion-change', { bubbles: true }));
        setPaused(nextPaused);
      }}
    >
      <Icon aria-hidden="true" size={14} />
      {reducedMotion ? 'Motion off' : paused ? 'Play animation' : 'Pause animation'}
    </button>
  );
}
