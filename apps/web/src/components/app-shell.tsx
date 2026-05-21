import Link from 'next/link';

import type { TeamMembership } from '@/lib/active-team';

import { TeamSwitcher } from '@/components/team-switcher';
import { UserMenu } from '@/components/user-menu';

interface Props {
  active: TeamMembership;
  memberships: TeamMembership[];
  user: { name?: string | null; email?: string | null };
  children: React.ReactNode;
}

export function AppShell({ active, memberships, user, children }: Props) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <Link href="/app/timeline" className="text-sm font-semibold tracking-tight">
              The Timeline
            </Link>
            <TeamSwitcher active={active} memberships={memberships} />
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/app/chat"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Chat
            </Link>
            <Link
              href="/app/entities"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Entities
            </Link>
            <Link
              href="/app/team"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Team
            </Link>
            <UserMenu user={user} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
    </div>
  );
}
