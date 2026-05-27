import { users } from '@timeline/db';
import { composePostmarkHashAddress, withTeam } from '@timeline/shared';
import { inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { removeMemberAction } from '@/app/actions/teams';
import { ActionChip } from '@/components/action-chip';
import { IndexStrip } from '@/components/index-strip';
import { InviteMemberForm, RenameTeamForm } from '@/components/team-forms';
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
  const team = await scope.timeline.team();

  const memberRows = await scope.timeline.listMembers();
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
        <div className="flex flex-wrap items-center gap-2 border-y border-border py-2">
          <ActionChip href="/app/team/jobs" label="Job recovery →" />
          <ActionChip href="/app/team/integrations/audit" label="Integration audit →" />
        </div>
      ) : null}

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

      {team ? (
        <Card>
          <CardHeader>
            <CardTitle>Email ingest</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Forward, CC, or BCC any email to this address to add it to the timeline.
            </p>
            {/* Address selection:
                - Production (team owns an MX domain): `team.inbound_email` is
                  the canonical clean address (`<slug>@<your-domain>`). Show it.
                - Dev (only Postmark's default address is wired): the column
                  holds the `@inbound.invalid` placeholder backfilled by the
                  Phase 7 migration; show the plus-addressed hash form
                  computed from POSTMARK_INBOUND_ADDRESS instead.
                - Migration (both configured, MX provisioned + dev fallback
                  still wired): prefer the production address. Hash form is
                  a fallback for routing, not a preferred display.

                The detection: a real `inbound_email` doesn't end in
                `@inbound.invalid`. That sentinel only appears on legacy
                teams backfilled by migration 0006 before they got a real
                domain, and is never produced by `buildInboundEmail` when
                INBOUND_EMAIL_DOMAIN is set. */}
            {(() => {
              const productionAddr =
                team.inboundEmail && !team.inboundEmail.endsWith('@inbound.invalid')
                  ? team.inboundEmail
                  : null;
              const hashAddr = composePostmarkHashAddress(
                team.slug,
                process.env.POSTMARK_INBOUND_ADDRESS,
              );
              const primary = productionAddr ?? hashAddr;
              if (!primary) return null;
              return <code className="block rounded-md bg-muted px-3 py-2 text-sm">{primary}</code>;
            })()}
            <p className="text-xs text-muted-foreground">
              Senders must match a team member&apos;s email to be attributed; unknown senders still
              land but are tagged unverified.
            </p>
          </CardContent>
        </Card>
      ) : null}

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
    </div>
  );
}
