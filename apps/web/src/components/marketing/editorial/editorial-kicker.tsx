import type { ReactNode } from 'react';

export function EditorialKicker({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[0.68rem] leading-relaxed tracking-[0.14em] text-signal uppercase">
      {children}
    </p>
  );
}
