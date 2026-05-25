'use client';

import { useLayoutEffect, useState } from 'react';

interface Pos {
  top: number;
  height: number;
}

export function AssociationLine({
  fromId,
  toId,
  containerSelector,
  label,
}: {
  fromId: string;
  toId: string;
  containerSelector: string;
  label?: string;
}) {
  const [pos, setPos] = useState<Pos | null>(null);

  useLayoutEffect(() => {
    function measure() {
      const from = document.getElementById(fromId);
      const to = document.getElementById(toId);
      const container = from?.closest(containerSelector) as HTMLElement | null;
      if (!from || !to || !container) {
        setPos(null);
        return;
      }
      const fromR = from.getBoundingClientRect();
      const toR = to.getBoundingClientRect();
      const cR = container.getBoundingClientRect();
      const topFrom = fromR.top + fromR.height / 2 - cR.top;
      const topTo = toR.top + toR.height / 2 - cR.top;
      setPos({ top: topFrom, height: Math.max(0, topTo - topFrom) });
    }

    measure();
    const ro = new ResizeObserver(measure);
    const from = document.getElementById(fromId);
    const to = document.getElementById(toId);
    if (from) ro.observe(from);
    if (to) ro.observe(to);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [fromId, toId, containerSelector]);

  if (!pos) return null;

  return (
    <>
      <span
        aria-hidden
        className="cdg-assoc pointer-events-none absolute left-0 w-px bg-signal/50"
        style={{ top: pos.top, height: pos.height, animationDelay: '5.4s' }}
      />
      {label && (
        <span
          aria-hidden
          className="cdg-assoc-label pointer-events-none absolute -left-1 -translate-x-full whitespace-nowrap pr-1 font-mono text-[9px] uppercase tracking-[0.14em] text-signal"
          style={{ top: pos.top + pos.height / 2 - 6, animationDelay: '5.6s' }}
        >
          {label}
        </span>
      )}
    </>
  );
}
