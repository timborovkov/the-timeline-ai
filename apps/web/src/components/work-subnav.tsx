'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ScrollableNav } from '@/components/scrollable-nav';
import { cn } from '@/lib/utils';

const WORK_LINKS = [
  { label: 'Overview', href: '/app/work' },
  { label: 'Objects', href: '/app/objects' },
  { label: 'Tasks', href: '/app/tasks' },
  { label: 'Boards', href: '/app/boards' },
  { label: 'Calendar', href: '/app/calendar' },
  { label: 'Updates', href: '/app/updates' },
  { label: 'Approvals', href: '/app/approvals' },
] as const;

export function WorkSubnav({
  current,
  className,
  spacing = 'flush',
}: {
  current: string;
  className?: string;
  spacing?: 'flush' | 'comfortable';
}) {
  const activePath = current === '/app/digests' ? '/app/updates' : current;
  return (
    <div
      data-slot="collection-tabs"
      className={cn(
        'min-w-0 shrink-0',
        spacing === 'flush' && !current.includes('/new') && !current.includes('/merge') && 'mb-0!',
        spacing === 'comfortable' && 'mb-6!',
      )}
    >
      <ScrollableNav
        activeKey={activePath}
        label="Work"
        cue="Swipe or scroll for more work views."
        className={cn('border-b border-border', className)}
      >
        {WORK_LINKS.map((item) => {
          const active = item.href.includes('?')
            ? activePath === item.href
            : item.href === '/app/work'
              ? activePath === item.href
              : activePath === item.href || activePath.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center border-b-2 border-transparent px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                active && 'border-signal text-fg',
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </ScrollableNav>
    </div>
  );
}

/** Shell-owned navigation stays in place while Work routes replace their content. */
export function WorkNavigation() {
  const pathname = usePathname();
  if (!pathname) return null;
  if (
    pathname !== '/app/digests' &&
    !WORK_LINKS.some(({ href }) => pathname === href || pathname.startsWith(`${href}/`))
  )
    return null;
  return (
    <div className="shrink-0 border-b border-border bg-bg px-4 md:px-8" data-slot="work-navigation">
      <WorkSubnav current={pathname} className="border-b-0" />
    </div>
  );
}
