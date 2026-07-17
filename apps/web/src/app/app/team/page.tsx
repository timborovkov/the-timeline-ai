import { teamExports, teamInvites, teamMembers, teams, users } from '@timeline/db';
import { getDigestPreference } from '@timeline/shared/messaging';
import { withTeam } from '@timeline/shared/team-scope';
import { and, desc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';
import type { ComponentProps } from 'react';

import {
  changeMemberRoleAction,
  removeMemberAction,
  resendInviteAction,
  revokeInviteAction,
} from '@/app/actions/teams';
import { ActionChip } from '@/components/action-chip';
import { PageHeader } from '@/components/page-header';
import { SettingsNav } from '@/components/settings-nav';
import {
  InboundEmailWhitelistForm,
  DigestPreferenceForm,
  InviteMemberForm,
  RenameTeamForm,
  TeamTimezoneForm,
  TeamExportPanel,
} from '@/components/team-forms';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { VisibilityDefaultSettings } from '@/components/visibility-default-settings';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { displayMemberLabel, displayRemovedMemberLabel } from '@/lib/display-labels';
import { getSiteUrl } from '@/lib/site-url';

export const metadata: Metadata = {
  title: 'Team settings',
  description: 'Manage team members, defaults, and access.',
};

interface UserInfo {
  id: string;
  name: string | null;
  email: string | null;
}
type UserMap = Map<string, UserInfo>;
interface MemberRow {
  userId: string;
  role: string;
}
interface InviteRow {
  id: string;
  email: string;
  role: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  lastSentAt: Date | null;
  sendStatus: string;
  sendError: string | null;
  invitedByUserId: string;
}
interface RemovedMemberRow {
  userId: string;
  role: string;
  removedAt: Date | null;
}
type InboundEmailWhitelistSettings = ComponentProps<typeof InboundEmailWhitelistForm>;
type TeamTimezoneSettings = ComponentProps<typeof TeamTimezoneForm>;

const SETTINGS_ITEMS = [
  { value: 'members', label: 'Members' },
  { value: 'general', label: 'General' },
  { value: 'preferences', label: 'Preferences' },
  { value: 'visibility', label: 'Visibility' },
  { value: 'email', label: 'Email' },
  { value: 'exports', label: 'Exports' },
  { value: 'advanced', label: 'Advanced', adminOnly: true },
] as const;

export default async function TeamSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; exportError?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const role = await scope.requireMembership();
  const isAdmin = role === 'owner' || role === 'admin';
  const isOwner = role === 'owner';
  const query = await searchParams;
  const requestedSection = query.section ?? 'members';
  const section = SETTINGS_ITEMS.some(
    (item) => item.value === requestedSection && (!('adminOnly' in item) || isAdmin),
  )
    ? requestedSection
    : 'members';

  const [memberRows, digestPreference] = await Promise.all([
    scope.timeline.listMembers(),
    getDigestPreference({
      db,
      teamId: active.teamId,
      userId: session.user.id,
    }),
  ]);
  const inboundEmailSettings: InboundEmailWhitelistSettings = isAdmin
    ? ((
        await db
          .select({
            inboundEmail: teams.inboundEmail,
            enabled: teams.inboundSenderWhitelistEnabled,
            senders: teams.inboundSenderWhitelist,
          })
          .from(teams)
          .where(eq(teams.id, active.teamId))
          .limit(1)
      )[0] ?? { inboundEmail: null, enabled: false, senders: [] })
    : { inboundEmail: null, enabled: false, senders: [] };
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
  const visibilityDefaults = isAdmin ? await scope.timeline.getVisibilityDefaults() : [];
  const timezoneSettings: TeamTimezoneSettings = {
    timezone: isAdmin ? (await scope.calendar.getCalendarSettings()).defaultTimezone : 'UTC',
  };
  const visibilityMembers = memberRows.map((m) => {
    const u = userMap.get(m.userId);
    return { id: m.userId, label: displayMemberLabel(u) };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        subtitle="Manage members, defaults, and access."
        srLabel={`Team ${active.teamName} · your role: ${role} · ${memberRows.length} members`}
        metadata={[
          { label: 'Team', value: active.teamName },
          { label: 'Role', value: role },
          { label: 'Members', value: memberRows.length, mono: true },
        ]}
      />
      <div className="flex flex-col gap-6 md:flex-row">
        <SettingsNav items={[...SETTINGS_ITEMS]} activeSection={section} isAdmin={isAdmin} />
        <div className="min-w-0 flex-1 space-y-5">
          {section === 'members' ? (
            <>
              <MembersCard
                members={memberRows}
                userMap={userMap}
                isAdmin={isAdmin}
                isOwner={isOwner}
                currentUserId={session.user.id}
              />
              <InviteCards
                isAdmin={isAdmin}
                isOwner={isOwner}
                invites={inviteRows}
                removedMembers={removedRows}
                userMap={userMap}
              />
            </>
          ) : null}
          {section === 'general' ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2">Team identity</CardTitle>
              </CardHeader>
              <CardContent>
                {isAdmin ? (
                  <RenameTeamForm currentName={active.teamName} teamId={active.teamId} />
                ) : (
                  <p className="text-sm text-fg-muted">
                    Only team administrators can rename this team.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : null}
          {section === 'preferences' ? (
            <>
              <MessagingPreferencesCard enabled={digestPreference.enabled} />
              {isAdmin ? (
                <Card>
                  <CardHeader>
                    <CardTitle as="h2">Team timezone</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TeamTimezoneForm {...timezoneSettings} />
                  </CardContent>
                </Card>
              ) : null}
            </>
          ) : null}
          {section === 'visibility' ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2">Visibility defaults</CardTitle>
              </CardHeader>
              <CardContent>
                {isAdmin ? (
                  <VisibilityDefaultSettings
                    defaults={visibilityDefaults}
                    members={visibilityMembers}
                  />
                ) : (
                  <p className="text-sm text-fg-muted">
                    Only team administrators can change visibility defaults.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : null}
          {section === 'email' ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2">Email sender whitelist</CardTitle>
              </CardHeader>
              <CardContent>
                {isAdmin ? (
                  <InboundEmailWhitelistForm {...inboundEmailSettings} />
                ) : (
                  <p className="text-sm text-fg-muted">
                    Only team administrators can change inbound email settings.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : null}
          {section === 'exports' ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2">Team export</CardTitle>
              </CardHeader>
              <CardContent>
                {isAdmin ? (
                  <TeamExportPanel exports={exportRows} downloadError={query.exportError} />
                ) : (
                  <p className="text-sm text-fg-muted">
                    Only team administrators can create exports.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : null}
          {section === 'advanced' && isAdmin ? <AdminShortcuts isAdmin /> : null}
        </div>
      </div>
    </div>
  );
}

function MessagingPreferencesCard({ enabled }: { enabled: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Messaging</CardTitle>
      </CardHeader>
      <CardContent>
        <DigestPreferenceForm enabled={enabled} />
      </CardContent>
    </Card>
  );
}

function AdminShortcuts({ isAdmin }: { isAdmin: boolean }) {
  if (!isAdmin) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-y border-border py-2">
      <ActionChip href="/app/team/jobs" label="Jobs" />
      <ActionChip href="/app/team/reconciliation" label="Reconciliation" />
      <ActionChip href="/app/team/audit" label="Audit" />
      <ActionChip href="/app/team/integrations/audit" label="Integration audit" />
    </div>
  );
}

function MembersCard({
  members,
  userMap,
  isAdmin,
  isOwner,
  currentUserId,
}: {
  members: MemberRow[];
  userMap: UserMap;
  isAdmin: boolean;
  isOwner: boolean;
  currentUserId: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Members</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {members.map((member) => (
            <MemberListItem
              key={member.userId}
              member={member}
              user={userMap.get(member.userId)}
              isAdmin={isAdmin}
              isOwner={isOwner}
              currentUserId={currentUserId}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function MemberListItem({
  member,
  user,
  isAdmin,
  isOwner,
  currentUserId,
}: {
  member: MemberRow;
  user: UserInfo | undefined;
  isAdmin: boolean;
  isOwner: boolean;
  currentUserId: string;
}) {
  const memberLabel = displayMemberLabel(user);
  return (
    <li className="flex items-center justify-between py-3">
      <div className="flex flex-col">
        <span className="text-sm font-medium">{memberLabel}</span>
        <span className="text-xs text-muted-foreground">{user?.email}</span>
      </div>
      <div className="flex items-center gap-3">
        {isOwner && member.userId !== currentUserId ? (
          <form action={changeMemberRoleAction} className="flex items-center gap-2">
            <input type="hidden" name="userId" value={member.userId} />
            <select
              aria-label={`Role for ${memberLabel}`}
              name="role"
              defaultValue={member.role}
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
          <Badge variant="outline">{member.role}</Badge>
        )}
        {isAdmin && member.userId !== currentUserId && (isOwner || member.role === 'member') ? (
          <form action={removeMemberAction}>
            <input type="hidden" name="userId" value={member.userId} />
            <Button type="submit" variant="ghost" size="sm" aria-label={`Remove ${memberLabel}`}>
              Remove
            </Button>
          </form>
        ) : null}
      </div>
    </li>
  );
}

function InviteCards({
  isAdmin,
  isOwner,
  invites,
  removedMembers,
  userMap,
}: {
  isAdmin: boolean;
  isOwner: boolean;
  invites: InviteRow[];
  removedMembers: RemovedMemberRow[];
  userMap: UserMap;
}) {
  if (!isAdmin) return null;
  return (
    <>
      <Card id="invite" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Invite a teammate</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteMemberForm canInviteAdmin={isOwner} />
        </CardContent>
      </Card>
      <PendingInvitesCard invites={invites} userMap={userMap} />
      <RemovedMembersCard removedMembers={removedMembers} userMap={userMap} />
    </>
  );
}

function PendingInvitesCard({ invites, userMap }: { invites: InviteRow[]; userMap: UserMap }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending invites</CardTitle>
      </CardHeader>
      <CardContent>
        {invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending invites.</p>
        ) : (
          <ul className="divide-y">
            {invites.map((invite) => (
              <PendingInviteItem
                key={invite.id}
                invite={invite}
                inviter={userMap.get(invite.invitedByUserId)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PendingInviteItem({
  invite,
  inviter,
}: {
  invite: InviteRow;
  inviter: UserInfo | undefined;
}) {
  const url = `${getSiteUrl()}/accept-invite/${invite.token}`;
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{invite.email}</p>
          <p className="text-xs text-muted-foreground">
            {invite.role} · invited by {inviter?.name ?? inviter?.email ?? 'Unknown'} · expires{' '}
            {invite.expiresAt.toLocaleDateString()}
          </p>
          {invite.sendStatus === 'failed' ? (
            <p className="text-xs text-destructive">
              Email failed: {invite.sendError ?? 'unknown error'}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Email {invite.sendStatus}
              {invite.lastSentAt ? ` · sent ${invite.lastSentAt.toLocaleDateString()}` : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <form action={resendInviteAction}>
            <input type="hidden" name="inviteId" value={invite.id} />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              aria-label={`Resend invite to ${invite.email}`}
            >
              Resend
            </Button>
          </form>
          <form action={revokeInviteAction}>
            <input type="hidden" name="inviteId" value={invite.id} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              aria-label={`Revoke invite to ${invite.email}`}
            >
              Revoke
            </Button>
          </form>
        </div>
      </div>
      <code className="block break-all rounded-md bg-muted px-3 py-2 text-[12px]">{url}</code>
    </li>
  );
}

function RemovedMembersCard({
  removedMembers,
  userMap,
}: {
  removedMembers: RemovedMemberRow[];
  userMap: UserMap;
}) {
  if (removedMembers.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Removed members</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {removedMembers.map((member) => {
            const user = userMap.get(member.userId);
            return (
              <li key={member.userId} className="flex items-center justify-between py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{displayRemovedMemberLabel(user)}</span>
                  <span className="text-xs text-muted-foreground">
                    {user?.email} · removed {member.removedAt?.toLocaleDateString()}
                  </span>
                </div>
                <Badge variant="outline">{member.role}</Badge>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
