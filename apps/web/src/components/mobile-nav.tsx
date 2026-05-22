'use client';

import { Clock, MessageSquare, Menu, Settings, Users, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { TeamMembership } from '@/lib/active-team';

import { TeamSwitcher } from '@/components/team-switcher';
import { cn } from '@/lib/utils';

const items = [
  { href: '/app/timeline', label: 'Timeline', icon: Clock },
  { href: '/app/chat', label: 'Chat', icon: MessageSquare },
  { href: '/app/entities', label: 'Entities', icon: Users },
  { href: '/app/team', label: 'Team', icon: Settings },
] as const;

interface Props {
  active: TeamMembership;
  memberships: TeamMembership[];
}

export function MobileNav({ active, memberships }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the sheet whenever the user navigates.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        aria-label="Open navigation"
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            onClick={() => {
              setOpen(false);
            }}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border/60 bg-background px-4 py-6 shadow-xl">
            <div className="flex items-center justify-between px-2">
              <span className="text-sm font-semibold tracking-tight">The Timeline</span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                }}
                aria-label="Close navigation"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="mt-8 flex flex-col gap-1">
              {items.map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                      isActive
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
            <div className="mt-auto space-y-3 border-t border-border/60 pt-4">
              <TeamSwitcher active={active} memberships={memberships} />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
