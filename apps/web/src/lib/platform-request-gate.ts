import { getDb, platformAdminAudit, users, teamMembers, teamBillingAccounts } from '@timeline/db';
import {
  IMPERSONATION_COOKIE,
  PlatformAccessError,
  requirePlatformActor,
  resolveImpersonation,
} from '@timeline/shared/platform-admin';
import { isInactiveWorkspaceSecurityState } from '@timeline/shared/platform-admin/runtime';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

import { ACTIVE_TEAM_COOKIE, parseActiveTeamCookie } from '@/lib/active-team-cookie';
import { db } from '@/lib/db';

const PERSONAL_PATHS =
  /\/(?:oauth|auth|mcp-keys|ingest-webhooks|calendar-subscription|integrations|connections|mcp-servers|mcp-share|connect-agent|agent-provisioning|telegram|slack|legal|billing)(?:\/|$)/;

export function isPersonalAccountPath(path: string): boolean {
  return PERSONAL_PATHS.test(path);
}
export async function platformRequestGate(
  request: NextRequest,
  session: Session | null,
): Promise<Response | null> {
  const path = request.nextUrl.pathname;
  const token = request.cookies.get(IMPERSONATION_COOKIE)?.value;
  if (path === '/api/platform-admin/exit') return null;
  const admin =
    path === '/app/admin' ||
    path.startsWith('/app/admin/') ||
    path.startsWith('/api/platform-admin/');
  if (!session?.user) return admin ? new Response('Not found', { status: 404 }) : null;
  const actor = { userId: session.user.id, email: session.user.email ?? '' };
  try {
    if (admin) {
      await requirePlatformActor(db, actor);
      return null;
    }
    const [user] = await db
      .select({ suspendedAt: users.suspendedAt })
      .from(users)
      .where(eq(users.id, actor.userId));
    if (
      user?.suspendedAt &&
      (path.startsWith('/app') || path.startsWith('/api/')) &&
      !path.startsWith('/api/auth/')
    )
      return new Response('Account suspended', { status: 403 });
    if (!token) return await suspendedWorkspaceResponse(request, actor.userId);
    if (
      isPersonalAccountPath(path) ||
      path.startsWith('/app/team/switch/') ||
      path === '/workspace-suspended'
    ) {
      if (request.method === 'GET' && !path.startsWith('/api/')) return exitImpersonationResponse();
      return new Response('Exit impersonation before managing accounts or connections.', {
        status: 403,
      });
    }
    // Session expiry must be revocable without re-entering the effective-user write guard.
    const impersonation = await resolveImpersonation(getDb(), actor, token);
    // Next dispatches read server actions via POST. The trusted operation name is
    // checked in runSentryServerAction; the header alone never authorizes a mutation.
    const serverAction =
      request.method === 'POST' && path.startsWith('/app/') && request.headers.has('next-action');
    if (impersonation.readOnly && !['GET', 'HEAD'].includes(request.method) && !serverAction)
      return new Response('Suspended inspection is read-only', { status: 403 });
    if (path.startsWith('/app') || path.startsWith('/api/')) {
      await db.insert(platformAdminAudit).values({
        actorUserId: actor.userId,
        effectiveUserId: impersonation.user.id,
        teamId: impersonation.session.teamId,
        sessionId: impersonation.session.id,
        action: ['GET', 'HEAD'].includes(request.method)
          ? 'impersonation.request.read'
          : 'impersonation.request.write',
        metadata: { method: request.method, surface: path.startsWith('/api/') ? 'api' : 'app' },
      });
    }
    return null;
  } catch (error) {
    if (!(error instanceof PlatformAccessError)) throw error;
    if (!admin && path.startsWith('/app')) return exitImpersonationResponse();
    return new Response(
      admin
        ? 'Not found'
        : 'Impersonation unavailable. Return to /app/admin to exit or start a new session.',
      { status: admin ? 404 : 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

function exitImpersonationResponse(): Response {
  return new Response(
    '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Exit impersonation</title><main><h1>Exit impersonation to continue</h1><p>This action requires your own account, or the support session is no longer available. Exit before reviewing and acknowledging legal notices.</p><form method="post" action="/api/platform-admin/exit"><button type="submit">Exit impersonation</button></form></main></html>',
    {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    },
  );
}

async function suspendedWorkspaceResponse(
  request: NextRequest,
  userId: string,
): Promise<Response | null> {
  const path = request.nextUrl.pathname;
  if (
    (!path.startsWith('/app') && !path.startsWith('/api/')) ||
    path.startsWith('/api/auth/') ||
    path.startsWith('/api/public/') ||
    path.startsWith('/app/team/switch/')
  )
    return null;
  const selected =
    parseActiveTeamCookie(request.cookies.get(ACTIVE_TEAM_COOKIE)?.value)?.teamId ?? null;
  const [team] = await db
    .select({ state: teamBillingAccounts.securityState })
    .from(teamMembers)
    .leftJoin(teamBillingAccounts, eq(teamBillingAccounts.teamId, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, userId), isNull(teamMembers.removedAt)))
    .orderBy(
      // Prefer a selectable workspace even when the cookie still names a
      // suspended/terminated team, so the selector can switch to another team.
      sql`CASE WHEN ${teamBillingAccounts.securityState} IN ('suspended', 'terminated') THEN 1 ELSE 0 END`,
      sql`CASE WHEN ${teamMembers.teamId} = ${selected}::uuid THEN 0 ELSE 1 END`,
      asc(teamMembers.createdAt),
    )
    .limit(1);
  if (!isInactiveWorkspaceSecurityState(team?.state)) return null;
  if (path.startsWith('/app') && request.method === 'GET')
    return Response.redirect(new URL('/workspace-suspended', request.url));
  return Response.json({ error: 'workspace_suspended' }, { status: 403 });
}
