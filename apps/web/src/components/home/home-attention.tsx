import { ArrowRight, CircleCheckBig } from 'lucide-react';
import Link from 'next/link';

import type { ReactNode } from 'react';

import { SectionHeading } from '@/components/section-heading';

export interface AttentionGroup {
  href: string;
  label: string;
  action: string;
  count: number;
  icon: ReactNode;
  danger?: boolean;
}

export function HomeAttention({ groups }: { groups: AttentionGroup[] }) {
  const visible = groups.filter((group) => group.count > 0);
  return (
    <section aria-labelledby="attention-heading" className="space-y-3">
      <SectionHeading id="attention-heading">Attention</SectionHeading>
      {visible.length === 0 ? (
        <div className="flex items-center gap-2 border-y border-border py-4 text-sm text-fg-muted">
          <CircleCheckBig aria-hidden="true" className="size-4 text-signal" />
          You’re caught up
        </div>
      ) : (
        <div className="divide-y divide-border border-y border-border">
          {visible.map((group) => (
            <Link
              key={group.href}
              href={group.href}
              className="group flex items-center gap-3 py-3 transition-colors hover:bg-surface sm:px-3"
            >
              <span className={`[&>svg]:size-4 ${group.danger ? 'text-danger' : 'text-signal'}`}>
                {group.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg">
                  <span className="font-mono">{group.count}</span> {group.label.toLowerCase()}
                </span>
                <span className="block text-xs text-fg-muted sm:hidden">{group.action}</span>
              </span>
              <span className="hidden text-xs text-fg-muted sm:block">{group.action}</span>
              <ArrowRight
                aria-hidden="true"
                className="size-4 text-fg-dim transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
