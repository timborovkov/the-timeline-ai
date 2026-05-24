import type { ReactNode } from 'react';

/**
 * Read-friendly column for prose/form pages — same `max-w-3xl` the
 * AppShell used to wrap every page in. Pages that need to fill the full
 * `<main>` width (kanban boards, table boards, anything with wide
 * horizontal data) simply skip this wrapper.
 *
 * Moved out of AppShell so kanban/table views aren't visually clipped to
 * 768px when there's plenty of `<main>` width available to fill.
 */
export function NarrowContainer({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl">{children}</div>;
}
