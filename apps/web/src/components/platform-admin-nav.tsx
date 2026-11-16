'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils';

const links = [
  ['Users', '/app/admin/users'],
  ['Teams', '/app/admin/teams'],
  ['Deletion requests', '/app/admin/teams?status=requested'],
  ['Audit', '/app/admin/audit'],
  ['Conversation reports', '/app/admin/diagnostics'],
  ['Billing', '/app/admin/billing'],
  ['Back to workspace', '/app'],
] as const;

export function PlatformAdminNav() {
  const pathname = usePathname();
  const search = useSearchParams();
  const deletions = pathname === '/app/admin/teams' && search.get('status') === 'requested';
  return (
    <nav
      aria-label="Platform administration"
      className="flex flex-wrap gap-2 border-b border-border pb-3 text-sm"
    >
      {links.map(([label, href]) => {
        const active = href.includes('?')
          ? deletions
          : href !== '/app' && !deletions && (pathname === href || pathname.startsWith(`${href}/`));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-11 items-center rounded-sm px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-signal-soft font-semibold underline underline-offset-4'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
