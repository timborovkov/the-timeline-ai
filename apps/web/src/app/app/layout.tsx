import { redirect } from 'next/navigation';

import type { ReactNode } from 'react';

import { AppShell } from '@/components/app-shell';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const { active, memberships } = await resolveActiveTeam(session.user.id);
  if (!active) {
    // A signed-in user without any team. Shouldn't happen after Phase 1
    // sign-up, but render an empty state rather than crash.
    return (
      <main className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-xl font-semibold">No team yet</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign out and create a new account, or ask a teammate for an invite link.
        </p>
      </main>
    );
  }

  return (
    <AppShell active={active} memberships={memberships} user={session.user}>
      {children}
    </AppShell>
  );
}
