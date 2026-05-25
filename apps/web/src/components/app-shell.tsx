import type { TeamMembership } from '@/lib/active-team';
import type { ReactNode } from 'react';

import { MobileNav } from '@/components/mobile-nav';
import { SidebarNav } from '@/components/sidebar-nav';
import { TeamSwitcher } from '@/components/team-switcher';
import { UserMenu } from '@/components/user-menu';

interface Props {
  active: TeamMembership;
  memberships: TeamMembership[];
  user: { name?: string | null; email?: string | null };
  children: ReactNode;
}

export function AppShell({ active, memberships, user, children }: Props) {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen w-full">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border/60 px-4 py-6 md:flex">
          <div className="px-2">
            <span className="text-sm font-semibold tracking-tight">The Timeline</span>
          </div>
          <SidebarNav />
          <div className="mt-auto space-y-3 border-t border-border/60 pt-4">
            <TeamSwitcher active={active} memberships={memberships} />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border/60 bg-background/85 px-6 backdrop-blur md:px-10">
            <div className="flex items-center gap-2 md:hidden">
              <MobileNav active={active} memberships={memberships} />
              <span className="text-sm font-semibold tracking-tight">The Timeline</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <UserMenu user={user} />
            </div>
          </header>
          {/* `<main>` no longer constrains content width. Prose/form pages
              wrap themselves in <NarrowContainer> for the read-friendly
              max-w-3xl column; wide layouts (kanban, table boards) skip
              the wrapper and fill the full main width. */}
          <main className="flex-1 px-6 py-10 md:px-10 md:py-14">{children}</main>
        </div>
      </div>
    </div>
  );
}
