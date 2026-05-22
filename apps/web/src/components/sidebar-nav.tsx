'use client';

import { Clock, MessageSquare, Settings, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const items = [
  { href: '/app/timeline', label: 'Timeline', icon: Clock },
  { href: '/app/chat', label: 'Chat', icon: MessageSquare },
  { href: '/app/entities', label: 'Entities', icon: Users },
  { href: '/app/team', label: 'Team', icon: Settings },
] as const;

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="mt-8 flex flex-col gap-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
