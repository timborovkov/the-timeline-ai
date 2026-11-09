'use client';

import {
  Cable,
  ChartColumn,
  Clock,
  Files,
  LayoutDashboard,
  LibraryBig,
  Menu,
  MessageSquare,
  Settings,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { Logo, Wordmark } from '@/components/brand/logo';
import { MOCKUP_TEAM } from '@/components/mockups/mockup-data';
import { SkipLink } from '@/components/skip-link';
import { ThemeToggle } from '@/components/theme-toggle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { initials } from '@/lib/initials';
import { cn } from '@/lib/utils';

type MockNavId =
  | 'home'
  | 'timeline'
  | 'ask'
  | 'work'
  | 'documents'
  | 'meetings'
  | 'connections'
  | 'usage'
  | 'team';

interface MockNavItem {
  id: MockNavId;
  href: string | null;
  label: string;
  icon: LucideIcon;
  group: 'overview' | 'workspace' | 'manage';
}

const NAV: readonly MockNavItem[] = [
  { id: 'home', href: '/mockups/today', label: 'Home', icon: LayoutDashboard, group: 'overview' },
  { id: 'timeline', href: null, label: 'Timeline', icon: Clock, group: 'overview' },
  { id: 'ask', href: '/mockups/approve', label: 'Ask', icon: MessageSquare, group: 'overview' },
  { id: 'work', href: '/mockups/milestones', label: 'Work', icon: LibraryBig, group: 'workspace' },
  { id: 'documents', href: null, label: 'Documents', icon: Files, group: 'workspace' },
  { id: 'meetings', href: null, label: 'Meetings', icon: Video, group: 'workspace' },
  { id: 'connections', href: null, label: 'Connections', icon: Cable, group: 'manage' },
  { id: 'usage', href: null, label: 'Usage', icon: ChartColumn, group: 'manage' },
  { id: 'team', href: null, label: 'Team', icon: Settings, group: 'manage' },
];

const GROUPS = [
  { id: 'overview', label: 'Overview' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'manage', label: 'Manage' },
] as const;

export function MockupShell({
  active,
  children,
  fullBleed = false,
}: {
  active: MockNavId;
  children: ReactNode;
  fullBleed?: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <TooltipProvider>
      <SkipLink />
      <div className="flex h-dvh w-full overflow-hidden bg-bg">
        <aside
          aria-label="Mockup application sidebar"
          className="sticky top-0 hidden h-full w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-3 md:flex"
        >
          <div className="flex w-full items-center justify-between gap-2">
            <Link
              href="/mockups"
              aria-label="Mockup index"
              className="flex h-9 min-w-0 items-center rounded-sm px-3 text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
            >
              <Wordmark compact className="min-w-0 gap-3" />
            </Link>
          </div>
          <nav
            aria-label="Primary"
            className="mt-4 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto"
          >
            {GROUPS.map((group) => (
              <div key={group.id} className="w-full">
                <p
                  aria-hidden="true"
                  className="mb-1 px-3 text-xs font-medium leading-[1.35] text-fg-dim"
                >
                  {group.label}
                </p>
                <ul aria-label={group.label} className="flex list-none flex-col gap-1 p-0">
                  {NAV.filter((item) => item.group === group.id).map((item) => (
                    <li key={item.id}>
                      <NavLink item={item} active={item.id === active} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <div className="flex h-9 w-full items-center gap-2 px-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-sm border border-border bg-bg text-[10px] font-semibold text-fg">
              {initials(MOCKUP_TEAM.name)}
            </span>
            <span className="min-w-0 truncate text-sm text-fg">{MOCKUP_TEAM.name}</span>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            role="note"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted md:px-4"
          >
            <p>
              Visual mockup · example data · not a product route ·{' '}
              <Link href="/mockups" className="text-fg underline-offset-2 hover:underline">
                All mockups
              </Link>
            </p>
            <p className="font-mono text-[11px] text-fg-dim">Do not merge</p>
          </div>
          <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-bg/90 px-3 backdrop-blur md:px-4">
            <div className="flex items-center gap-2 md:hidden">
              <button
                type="button"
                aria-expanded={mobileOpen}
                aria-controls="mockup-mobile-nav"
                aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
                onClick={() => {
                  setMobileOpen((open) => !open);
                }}
                className="grid size-9 place-items-center rounded-sm text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
              >
                {mobileOpen ? (
                  <X aria-hidden="true" className="size-4" />
                ) : (
                  <Menu aria-hidden="true" className="size-4" />
                )}
              </button>
              <span className="text-sm font-semibold tracking-tight text-fg">The Timeline</span>
            </div>
            <p className="hidden truncate text-sm text-fg-muted md:block">
              team · {MOCKUP_TEAM.name}
              <span className="mx-2 text-fg-dim">·</span>
              example data
            </p>
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              <span
                title={`${MOCKUP_TEAM.viewer} · ${MOCKUP_TEAM.viewerRole}`}
                className="grid size-8 place-items-center rounded-sm border border-border bg-surface text-[11px] font-semibold text-fg"
              >
                {initials(MOCKUP_TEAM.viewer)}
              </span>
            </div>
          </header>
          {mobileOpen ? (
            <nav
              id="mockup-mobile-nav"
              aria-label="Primary"
              className="border-b border-border bg-surface px-3 py-3 md:hidden"
            >
              <ul className="flex list-none flex-col gap-1 p-0">
                {NAV.map((item) => (
                  <li key={item.id}>
                    <NavLink item={item} active={item.id === active} expanded />
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          <main
            id="main"
            className={cn(
              'min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain',
              fullBleed ? 'flex flex-col p-0' : 'px-4 pb-24 pt-6 md:px-8 md:py-8',
            )}
          >
            {fullBleed ? (
              children
            ) : (
              <div
                data-slot="app-page-container"
                className="app-page-container mx-auto w-full min-w-0 max-w-6xl"
              >
                {children}
              </div>
            )}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

function NavLink({
  item,
  active,
  expanded = true,
}: {
  item: MockNavItem;
  active: boolean;
  expanded?: boolean;
}) {
  const pathname = usePathname();
  const className = cn(
    'relative rounded-sm transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
    expanded ? 'flex h-9 w-full items-center gap-3 px-3 text-sm' : 'grid size-9 place-items-center',
    active
      ? 'bg-surface-2 font-medium text-signal'
      : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
    !item.href && !active && 'cursor-default opacity-70',
  );
  const Icon = item.icon;
  const content = (
    <>
      {active ? (
        <span aria-hidden="true" className="absolute start-0 top-1.5 h-6 w-0.5 bg-signal" />
      ) : null}
      <Icon aria-hidden="true" className="size-4" />
      {expanded ? <span className="min-w-0 flex-1 truncate">{item.label}</span> : null}
    </>
  );

  if (!item.href) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={className} title="Not in this mockup">
            {content}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">Not in this mockup</TooltipContent>
      </Tooltip>
    );
  }

  const isCurrent = active || pathname === item.href;
  return (
    <Link href={item.href} aria-current={isCurrent ? 'page' : undefined} className={className}>
      {content}
    </Link>
  );
}

export function MockupIndexChrome({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <SkipLink />
      <div
        role="note"
        className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2 text-xs text-fg-muted"
      >
        <p>Visual mockups · example data · isolated from the product · do not merge</p>
        <ThemeToggle />
      </div>
      <header className="border-b border-border px-4 py-4 md:px-8">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <Logo className="size-5 text-fg" />
          <p className="text-sm font-semibold tracking-tight">The Timeline</p>
        </div>
      </header>
      <main id="main" className="px-4 py-8 md:px-8">
        <div className="mx-auto max-w-3xl">{children}</div>
      </main>
    </div>
  );
}
