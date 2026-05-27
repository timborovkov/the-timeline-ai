import { teamExports, teamInvites, teamMembers, users } from '@timeline/db';
import { withTeam } from '@timeline/shared';
import { and, desc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  changeMemberRoleAction,
  removeMemberAction,
  resendInviteAction,
  revokeInviteAction,
} from '@/app/actions/teams';
import { IndexStrip } from '@/components/index-strip';
import { TeamAccessPanel } from '@/components/team-access-panel';
import { InviteMemberForm, RenameTeamForm, TeamExportPanel } from '@/components/team-forms';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export default async function TeamSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const role = await scope.requireMembership();
  const isAdmin = role === 'owner' || role === 'admin';
  const isOwner = role === 'owner';
  const team = await scope.timeline.team();

  const memberRows = await scope.timeline.listMembers();
  if (isAdmin) {
    await db
      .update(teamExports)
      .set({ status: 'expired' })
      .where(
        and(
          eq(teamExports.teamId, active.teamId),
          eq(teamExports.status, 'ready'),
          lt(teamExports.expiresAt, new Date()),
        ),
      );
  }
  const exportRows = isAdmin
    ? await db
        .select({
          id: teamExports.id,
          status: teamExports.status,
          createdAt: teamExports.createdAt,
          completedAt: teamExports.completedAt,
          expiresAt: teamExports.expiresAt,
          error: teamExports.error,
        })
        .from(teamExports)
        .where(
          and(
            eq(teamExports.teamId, active.teamId),
            eq(teamExports.requestedByUserId, session.user.id),
          ),
        )
        .orderBy(desc(teamExports.createdAt))
        .limit(10)
    : [];
  const removedRows = isAdmin
    ? await db
        .select({
          userId: teamMembers.userId,
          role: teamMembers.role,
          removedAt: teamMembers.removedAt,
        })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, active.teamId), isNotNull(teamMembers.removedAt)))
        .orderBy(desc(teamMembers.removedAt))
    : [];
  const inviteRows = isAdmin
    ? await db
        .select({
          id: teamInvites.id,
          email: teamInvites.email,
          role: teamInvites.role,
          token: teamInvites.token,
          expiresAt: teamInvites.expiresAt,
          createdAt: teamInvites.createdAt,
          lastSentAt: teamInvites.lastSentAt,
          sendStatus: teamInvites.sendStatus,
          sendError: teamInvites.sendError,
          invitedByUserId: teamInvites.invitedByUserId,
        })
        .from(teamInvites)
        .where(
          and(
            eq(teamInvites.teamId, active.teamId),
            isNull(teamInvites.acceptedAt),
            isNull(teamInvites.revokedAt),
            isOwner ? undefined : eq(teamInvites.role, 'member'),
          ),
        )
        .orderBy(desc(teamInvites.createdAt))
    : [];
  const userIds = Array.from(
    new Set([
      ...memberRows.map((m) => m.userId),
      ...removedRows.map((m) => m.userId),
      ...inviteRows.map((i) => i.invitedByUserId),
    ]),
  );
  const userInfo =
    userIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];
  const userMap = new Map(userInfo.map((u) => [u.id, u] as const));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <IndexStrip
        srLabel={`Team ${active.teamName} · your role: ${role} · ${memberRows.length} members`}
        segments={[
          { value: 'TEAM' },
          { label: 'name', value: active.teamName, signal: true },
          { label: 'role', value: role },
          { label: 'members', value: memberRows.length },
        ]}
      />

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Team identity</CardTitle>
          </CardHeader>
          <CardContent>
            <RenameTeamForm currentName={active.teamName} teamId={active.teamId} />
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Team export</CardTitle>
          </CardHeader>
          <CardContent>
            <TeamExportPanel exports={exportRows} />
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Trust audit</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Sensitive reads and security-relevant team actions.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/app/team/audit">Open audit</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <TeamAccessPanel team={team} />

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {memberRows.map((m) => {
              const u = userMap.get(m.userId);
              return (
                <li key={m.userId} className="flex items-center justify-between py-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{u?.name ?? u?.email ?? m.userId}</span>
                    <span className="text-xs text-muted-foreground">{u?.email}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {isOwner && m.userId !== session.user.id ? (
                      <form action={changeMemberRoleAction} className="flex items-center gap-2">
                        <input type="hidden" name="userId" value={m.userId} />
                        <select
                          name="role"
                          defaultValue={m.role}
                          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                          <option value="owner">Owner</option>
                        </select>
                        <Button type="submit" variant="outline" size="sm">
                          Save
                        </Button>
                      </form>
                    ) : (
                      <Badge variant="outline">{m.role}</Badge>
                    )}
                    {isAdmin && m.userId !== session.user.id && (isOwner || m.role === 'member') ? (
                      <form action={removeMemberAction}>
                        <input type="hidden" name="userId" value={m.userId} />
                        <Button type="submit" variant="ghost" size="sm">
                          Remove
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Invite a teammate</CardTitle>
          </CardHeader>
          <CardContent>
            <InviteMemberForm canInviteAdmin={isOwner} />
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending invites</CardTitle>
          </CardHeader>
          <CardContent>
            {inviteRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending invites.</p>
            ) : (
              <ul className="divide-y">
                {inviteRows.map((invite) => {
                  const inviter = userMap.get(invite.invitedByUserId);
                  const url = `${process.env.AUTH_URL ?? 'http://localhost:3000'}/accept-invite/${invite.token}`;
                  return (
                    <li key={invite.id} className="space-y-2 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{invite.email}</p>
                          <p className="text-xs text-muted-foreground">
                            {invite.role} · invited by{' '}
                            {inviter?.name ?? inviter?.email ?? 'Unknown'} · expires{' '}
                            {invite.expiresAt.toLocaleDateString()}
                          </p>
                          {invite.sendStatus === 'failed' ? (
                            <p className="text-xs text-destructive">
                              Email failed: {invite.sendError ?? 'unknown error'}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Email {invite.sendStatus}
                              {invite.lastSentAt
                                ? ` · sent ${invite.lastSentAt.toLocaleDateString()}`
                                : ''}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <form action={resendInviteAction}>
                            <input type="hidden" name="inviteId" value={invite.id} />
                            <Button type="submit" variant="outline" size="sm">
                              Resend
                            </Button>
                          </form>
                          <form action={revokeInviteAction}>
                            <input type="hidden" name="inviteId" value={invite.id} />
                            <Button type="submit" variant="ghost" size="sm">
                              Revoke
                            </Button>
                          </form>
                        </div>
                      </div>
                      <code className="block break-all rounded-md bg-muted px-3 py-2 text-[12px]">
                        {url}
                      </code>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {isAdmin && removedRows.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Removed members</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {removedRows.map((m) => {
                const u = userMap.get(m.userId);
                return (
                  <li key={m.userId} className="flex items-center justify-between py-3">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{u?.name ?? u?.email ?? m.userId}</span>
                      <span className="text-xs text-muted-foreground">
                        {u?.email} · removed {m.removedAt?.toLocaleDateString()}
                      </span>
                    </div>
                    <Badge variant="outline">{m.role}</Badge>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
