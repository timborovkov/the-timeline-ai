import type { ReactNode } from 'react';

export function EditorialKicker({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-fg-muted">{children}</p>;
}
