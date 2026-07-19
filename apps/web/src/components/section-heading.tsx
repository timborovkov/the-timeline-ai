import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface SectionHeadingProps {
  /** The section title. Sentence-case, not mono uppercase. */
  children: ReactNode;
  /** Optional right-aligned actions (buttons, links). */
  actions?: ReactNode;
  /** Optional id for the h2 (useful for aria-labelledby). */
  id?: string;
  className?: string;
}

/**
 * Sentence-case section heading for standard pages. Replaces the
 * mono-uppercase eyebrow labels (`font-mono text-[11px] uppercase
 * tracking-[0.14em]`) that sat above content blocks on Home, Sources,
 * Integrations, etc.
 *
 * Timeline and explicit audit/operator surfaces may keep `IndexStrip` for
 * compact metadata; all ordinary section titles use this component.
 */
export function SectionHeading({ children, actions, id, className }: SectionHeadingProps) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <h2 id={id} className="m-0 text-base font-semibold tracking-tight text-fg">
        {children}
      </h2>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
