import { ArrowRight, CircleCheckBig } from 'lucide-react';
import Link from 'next/link';

import type { ReactNode } from 'react';

export interface AttentionGroup {
  href: string;
  label: string;
  singularLabel?: string;
  action: string;
  count: number;
  icon: ReactNode;
  danger?: boolean;
}

export function HomeAttention({ groups, title }: { groups: AttentionGroup[]; title?: string }) {
  const visible = groups.filter((group) => group.count > 0);
  return (
    <section aria-label={title ?? 'Attention'}>
      {title ? <h2 className="mb-3 text-base font-semibold text-fg">{title}</h2> : null}
      {visible.length === 0 ? (
        <div className="flex items-center gap-2 py-4 text-sm text-fg-muted">
          <CircleCheckBig aria-hidden="true" className="size-4 text-signal" />
          You’re caught up
        </div>
      ) : (
        <div className="divide-y divide-border">
          {visible.map((group) => (
            <Link
              key={group.href}
              href={group.href}
              className="group flex items-center gap-3 py-3 transition-colors hover:bg-surface sm:px-3"
            >
              <span className={`[&>svg]:size-4 ${group.danger ? 'text-danger' : 'text-fg-muted'}`}>
                {group.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg">
                  <span className="font-mono">{group.count}</span>{' '}
                  {(group.count === 1
                    ? (group.singularLabel ?? group.label)
                    : group.label
                  ).toLowerCase()}
                </span>
                <span className="block text-xs text-fg-muted sm:hidden">{group.action}</span>
              </span>
              <span className="hidden text-xs text-fg-muted sm:block">{group.action}</span>
              <ArrowRight
                aria-hidden="true"
                className="size-4 text-fg-dim transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
              />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
