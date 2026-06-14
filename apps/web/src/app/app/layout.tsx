import { teamInvites, teams, users } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AnalyticsProvider } from '@/components/analytics-provider';
import { AppShell } from '@/components/app-shell';
import { QueryProvider } from '@/components/query-provider';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getNavAttentionSummary } from '@/lib/hub-status';
import { getUserLegalAcceptance, hasCurrentLegalAcceptance } from '@/lib/legal';
import { reportCaughtError } from '@/lib/sentry-report';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AppLayout({
  children,
  modal,
}: {
  children: ReactNode;
  modal: ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const [legal, activeTeam, currentUsers] = await Promise.all([
    getUserLegalAcceptance(session.user.id),
    resolveActiveTeam(session.user.id),
    db
      .select({ email: users.email, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1),
  ]);
  if (!legal || !hasCurrentLegalAcceptance(legal)) {
    redirect('/legal/accept');
  }

  const { active, memberships } = activeTeam;
  const currentUser = currentUsers[0];
  const verifiedEmail = currentUser?.emailVerified ? currentUser.email.toLowerCase() : null;
  const recipientInvites = verifiedEmail
    ? await db
        .select({
          id: teamInvites.id,
          role: teamInvites.role,
          expiresAt: teamInvites.expiresAt,
          teamName: teams.name,
          inviterName: users.name,
          inviterEmail: users.email,
        })
        .from(teamInvites)
        .innerJoin(teams, eq(teams.id, teamInvites.teamId))
        .innerJoin(users, eq(users.id, teamInvites.invitedByUserId))
        .where(
          and(
            sql`lower(${teamInvites.email}) = ${verifiedEmail}`,
            isNull(teamInvites.acceptedAt),
            isNull(teamInvites.revokedAt),
            gt(teamInvites.expiresAt, new Date()),
            ne(teamInvites.role, 'owner'),
          ),
        )
    : [];
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

  const [badges, inbox] = await Promise.all([
    getNavAttentionSummary(active.teamId, session.user.id).catch((err: unknown) => {
      console.error('[app-shell] failed to load navigation attention badges', err);
      reportCaughtError(err, { surface: 'layout', operation: 'nav_attention_summary' });
      return {};
    }),
    (async () => {
      try {
        const scope = withTeam(db, active.teamId, session.user.id);
        const [unreadCount, notifications] = await Promise.all([
          scope.objects.unreadNotificationCount(),
          scope.objects.listNotifications({ limit: 5, order: 'latest' }),
        ]);
        return {
          unreadCount,
          notifications: notifications.map((notification) => ({
            id: notification.id,
            kind: notification.kind,
            summary: notification.summary,
            entityId: notification.entityId,
            agentSuggestionId: notification.agentSuggestionId,
            createdAt: notification.createdAt.toISOString(),
            readAt: notification.readAt?.toISOString() ?? null,
          })),
        };
      } catch (err) {
        console.error('[app-shell] failed to load inbox preview', err);
        reportCaughtError(err, { surface: 'layout', operation: 'inbox_preview' });
        return { unreadCount: 0, notifications: [] };
      }
    })(),
  ]);

  return (
    <AnalyticsProvider userId={session.user.id} teamId={active.teamId}>
      <QueryProvider>
        <AppShell
          active={active}
          memberships={memberships}
          recipientInvites={recipientInvites.map((invite) => ({
            id: invite.id,
            teamName: invite.teamName,
            role: invite.role === 'owner' ? 'member' : invite.role,
            expiresAt: invite.expiresAt.toISOString(),
            invitedBy: invite.inviterName ?? invite.inviterEmail,
          }))}
          user={session.user}
          badges={badges}
          inbox={inbox}
        >
          {children}
          {modal}
        </AppShell>
      </QueryProvider>
    </AnalyticsProvider>
  );
}
