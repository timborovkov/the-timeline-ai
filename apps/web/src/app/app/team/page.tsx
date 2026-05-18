import { users } from '@timeline/db';
import { withTeam } from '@timeline/shared';
import { inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { removeMemberAction } from '@/app/actions/teams';
import { CreateTeamForm, InviteMemberForm } from '@/components/team-forms';
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

  const memberRows = await scope.listMembers();
  const userIds = memberRows.map((m) => m.userId);
  const userInfo =
    userIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];
  const userMap = new Map(userInfo.map((u) => [u.id, u] as const));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Team settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {active.teamName} · your role: <Badge variant="outline">{role}</Badge>
        </p>
      </header>

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
                    <Badge variant="outline">{m.role}</Badge>
                    {isAdmin && m.userId !== session.user.id && m.role !== 'owner' ? (
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
            <InviteMemberForm />
            <p className="mt-3 text-xs text-muted-foreground">
              Email delivery lands in Phase 7. For now the invite link is shown here — copy and
              share it manually.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Create another team</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateTeamForm />
        </CardContent>
      </Card>
    </div>
  );
}
