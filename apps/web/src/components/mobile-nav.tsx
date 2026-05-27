'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { TeamMembership } from '@/lib/active-team';

import { isNavItemActive, visibleNavItems } from '@/components/nav-items';
import { TeamSwitcher } from '@/components/team-switcher';
import { cn } from '@/lib/utils';

interface Props {
  active: TeamMembership;
  memberships: TeamMembership[];
}

export function MobileNav({ active, memberships }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Tailwind's `md` breakpoint is 768px. The sheet only renders below `md`
  // via `md:hidden`. If the viewport widens past 768px while the sheet is
  // open (rotation, resize, devtools), the overlay disappears via CSS but
  // React state stays `open: true` — which keeps `body.overflow: hidden`
  // applied forever. Listen for the breakpoint crossing and force-close so
  // the cleanup effect above releases scroll.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    mq.addEventListener('change', handler);
    return () => {
      mq.removeEventListener('change', handler);
    };
  }, []);

  // Escape closes the sheet
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
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
        aria-expanded={open}
        className="grid size-9 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg md:hidden"
      >
        <Menu className="size-5" />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div
            className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
            onClick={() => {
              setOpen(false);
            }}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-bg px-4 py-5">
            <div className="flex items-center justify-between px-2">
              <span className="font-mono text-xs uppercase tracking-[0.14em] text-fg">
                The Timeline
              </span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                }}
                aria-label="Close navigation"
                className="grid size-8 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                <X className="size-4" />
              </button>
            </div>
            <nav aria-label="Primary" className="mt-8 flex flex-col gap-1">
              {visibleNavItems(active.role).map((item) => {
                const isActive = isNavItemActive(item, pathname);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => {
                      setOpen(false);
                    }}
                    className={cn(
                      'flex items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-surface-2 text-signal'
                        : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-auto space-y-3 border-t border-border pt-4">
              <TeamSwitcher active={active} memberships={memberships} />
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
