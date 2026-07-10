'use client';

import { BookOpen, ExternalLink, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import type { RecipientInvite } from '@/components/team-switcher';
import type { TeamMembership } from '@/lib/active-team';

import {
  formatNavBadge,
  isNavItemActive,
  type NavBadgeMap,
  visibleNavItems,
} from '@/components/nav-items';
import { TeamSwitcher } from '@/components/team-switcher';
import { cn } from '@/lib/utils';

interface Props {
  active: TeamMembership;
  memberships: TeamMembership[];
  recipientInvites: RecipientInvite[];
  badges?: NavBadgeMap;
}

const EMPTY_BADGES: NavBadgeMap = {};

export function MobileNav({ active, memberships, recipientInvites, badges = EMPTY_BADGES }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  function closeNavigation() {
    const dialog = dialogRef.current;
    if (dialog?.open && typeof dialog.close === 'function') dialog.close();
    else setOpen(false);
  }

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    closeRef.current?.focus();
    const opener = openerRef.current;

    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      opener?.focus();
    };
  }, [open]);

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

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        aria-label="Open navigation"
        aria-expanded={open}
        className="grid size-9 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg md:hidden"
      >
        <Menu className="size-5" />
      </button>

      {open ? (
        <dialog
          ref={dialogRef}
          className="fixed inset-0 z-50 m-0 h-dvh max-h-none w-screen max-w-none overscroll-contain bg-transparent p-0 md:hidden"
          aria-label="Navigation"
          onCancel={(event) => {
            event.preventDefault();
            closeNavigation();
          }}
          onClose={() => {
            setOpen(false);
          }}
        >
          <button
            type="button"
            className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
            onClick={() => {
              closeNavigation();
            }}
            aria-label="Close navigation"
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overscroll-contain border-r border-border bg-bg px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))]">
            <div className="flex items-center justify-between px-2">
              <span className="font-mono text-xs uppercase tracking-[0.14em] text-fg">
                The Timeline
              </span>
              <button
                ref={closeRef}
                type="button"
                onClick={() => {
                  closeNavigation();
                }}
                aria-label="Close navigation"
                className="grid size-8 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
              >
                <X className="size-4" />
              </button>
            </div>
            <nav aria-label="Primary" className="mt-8 flex flex-col gap-1">
              {visibleNavItems(active.role).map((item) => {
                const isActive = isNavItemActive(item, pathname);
                const Icon = item.icon;
                const badge = formatNavBadge(item.badgeKey ? badges[item.badgeKey] : undefined);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => {
                      closeNavigation();
                    }}
                    className={cn(
                      'flex items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
                      isActive
                        ? 'bg-surface-2 text-signal'
                        : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {badge ? (
                      <span
                        aria-label={`${item.label} attention ${badge}`}
                        className={cn(
                          'grid h-5 min-w-5 place-items-center rounded-sm border px-1 font-mono text-[10px]',
                          isActive
                            ? 'border-signal/40 bg-bg text-signal'
                            : 'border-danger/40 text-danger',
                        )}
                      >
                        {badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-auto space-y-3 border-t border-border pt-4">
              <Link
                href="/help"
                target="_blank"
                rel="noreferrer"
                aria-label="Open help docs in a new tab"
                onClick={() => {
                  closeNavigation();
                }}
                className="flex items-center gap-3 rounded-sm px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
              >
                <BookOpen aria-hidden="true" className="size-4" />
                <span className="min-w-0 flex-1 truncate">Help</span>
                <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
              </Link>
              <TeamSwitcher
                active={active}
                memberships={memberships}
                recipientInvites={recipientInvites}
              />
            </div>
          </aside>
        </dialog>
      ) : null}
    </>
  );
}
