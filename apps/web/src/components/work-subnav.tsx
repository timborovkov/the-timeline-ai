import Link from 'next/link';

import { cn } from '@/lib/utils';

const WORK_LINKS = [
  { label: 'Overview', href: '/app/work' },
  { label: 'Pinned', href: '/app/work?view=pinned' },
  { label: 'Objects', href: '/app/objects' },
  { label: 'Tasks', href: '/app/tasks' },
  { label: 'Boards', href: '/app/boards' },
  { label: 'Calendar', href: '/app/calendar' },
  { label: 'Digests', href: '/app/digests' },
  { label: 'Approvals', href: '/app/approvals' },
] as const;

export function WorkSubnav({ current, className }: { current: string; className?: string }) {
  return (
    <nav aria-label="Work" className={cn('overflow-x-auto border-b border-border', className)}>
      <div className="flex min-w-max gap-1">
        {WORK_LINKS.map((item) => {
          const active = item.href.includes('?')
            ? current === item.href
            : item.href === '/app/work'
              ? current === item.href
              : current === item.href || current.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'border-b-2 border-transparent px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                active && 'border-signal text-fg',
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
