import { teamInvites, teams, users } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AnalyticsProvider } from '@/components/analytics-provider';
import { AppShell } from '@/components/app-shell';
import { QueryProvider } from '@/components/query-provider';
import { resolveActiveTeam } from '@/lib/active-team';
import { appMetadataForTeam } from '@/lib/app-metadata';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { retryOwnedTeamFreeGrantsAfterSignIn } from '@/lib/email-verification';
import { getNavAttentionSummary } from '@/lib/hub-status';
import { getUserLegalAcceptance, hasCurrentLegalAcceptance } from '@/lib/legal';
import { reportCaughtError } from '@/lib/sentry-report';
import { SIDEBAR_COOKIE_KEY, sidebarExpandedFromCookie } from '@/lib/sidebar-preference';
import { DEFAULT_TIMEZONE } from '@/lib/timezones';

export async function generateMetadata(): Promise<Metadata> {
  const session = await auth();
  if (!session?.user) {
    return appMetadataForTeam(null);
  }

  const { active } = await resolveActiveTeam(session.user.id);
  return appMetadataForTeam(active?.teamName ?? null);
}

export default async function AppLayout({
  children,
  modal,
}: {
  children: ReactNode;
  modal: ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const [legal, activeTeam, currentUsers, cookieStore] = await Promise.all([
    getUserLegalAcceptance(session.user.id),
    resolveActiveTeam(session.user.id),
    db
      .select({ email: users.email, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1),
    cookies(),
  ]);
  if (!legal || !hasCurrentLegalAcceptance(legal)) {
    redirect('/legal/accept');
  }

  const { active, memberships } = activeTeam;
  const currentUser = currentUsers[0];
  const currentEmail = currentUser?.email ? currentUser.email.toLowerCase() : null;
  if (currentUser?.emailVerified) {
    try {
      await retryOwnedTeamFreeGrantsAfterSignIn({
        db,
        userId: session.user.id,
        emailVerified: currentUser.emailVerified,
      });
    } catch (err) {
      reportCaughtError(err, { surface: 'layout', operation: 'free_grant_claim' });
    }
  }
  const recipientInvites = currentEmail
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
            sql`lower(${teamInvites.email}) = ${currentEmail}`,
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

  const scope = withTeam(db, active.teamId, session.user.id);
  const [badges, inbox, workspaceTimezone, billingSummary] = await Promise.all([
    getNavAttentionSummary(active.teamId, session.user.id).catch((err: unknown) => {
      console.error('[app-shell] failed to load navigation attention badges', err);
      reportCaughtError(err, { surface: 'layout', operation: 'nav_attention_summary' });
      return {};
    }),
    (async () => {
      try {
        const [unreadCount, notifications] = await Promise.all([
          scope.objects.unreadNotificationCount(),
          scope.objects.listNotifications({ limit: 5 }),
        ]);
        return {
          unreadCount,
          notifications: notifications.map((notification) => ({
            id: notification.id,
            kind: notification.kind,
            summary: notification.summary,
            entityId: notification.entityId,
            agentSuggestionId: notification.agentSuggestionId,
            payload: notification.payload,
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
    scope.calendar
      .getCalendarSettings()
      .then((settings) => settings.defaultTimezone)
      .catch((err: unknown) => {
        console.error('[app-shell] failed to load calendar settings', err);
        reportCaughtError(err, { surface: 'layout', operation: 'calendar_settings' });
        return DEFAULT_TIMEZONE;
      }),
    (async () => {
      try {
        const role = await scope.requireMembership();
        const canManage = role === 'owner' || role === 'admin';
        const dash = await scope.billing.getDashboard({ canManageBilling: canManage });
        return dash.sidebar;
      } catch (err) {
        console.error('[app-shell] failed to load billing summary', err);
        reportCaughtError(err, { surface: 'layout', operation: 'billing_summary' });
        return null;
      }
    })(),
  ]);

  const sidebarInitiallyExpanded = sidebarExpandedFromCookie(
    cookieStore.get(SIDEBAR_COOKIE_KEY)?.value,
  );

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
          user={{
            name: session.user.name,
            email: currentUser?.email ?? session.user.email,
            emailVerified: currentUser?.emailVerified ?? null,
          }}
          badges={badges}
          inbox={inbox}
          workspaceTimezone={workspaceTimezone}
          sidebarInitiallyExpanded={sidebarInitiallyExpanded}
          billingSummary={billingSummary}
        >
          {children}
          {modal}
        </AppShell>
      </QueryProvider>
    </AnalyticsProvider>
  );
}
