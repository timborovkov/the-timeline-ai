import {
  telegramChatBindings,
  teamExports,
  teamInvites,
  teamMembers,
  teams,
  users,
} from '@timeline/db';
import { getEnv } from '@timeline/shared/env';
import { listTeamDigestDestinations, getDigestPreference } from '@timeline/shared/messaging';
import { hasSlackInstallForTeam, listSlackConversationsForTeam } from '@timeline/shared/slack';
import { withTeam } from '@timeline/shared/team-scope';
import { and, desc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';
import type { ComponentProps } from 'react';

import { ActionChip } from '@/components/action-chip';
import { CopyableTextField } from '@/components/copyable-text-field';
import {
  DigestDestinationsForm,
  type DigestDestinationOption,
} from '@/components/digest-destinations';
import { PageHeader } from '@/components/page-header';
import { SettingsSection } from '@/components/section-heading';
import { SettingsNav } from '@/components/settings-nav';
import {
  InboundEmailWhitelistForm,
  DigestPreferenceForm,
  RenameTeamForm,
  TeamTimezoneForm,
  TeamExportPanel,
} from '@/components/team-forms';
import { TeamMembersSettings } from '@/components/team-members-settings';
import { VisibilityDefaultSettings } from '@/components/visibility-default-settings';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { displayMemberLabel } from '@/lib/display-labels';
import { displayInboundEmail } from '@/lib/hub-status';

export const metadata: Metadata = {
  title: 'Team settings',
  description: 'Manage team members, defaults, and access.',
};

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

  const [memberRows, digestPreference, digestDestinations] = await Promise.all([
    scope.timeline.listMembers(),
    getDigestPreference({
      db,
      teamId: active.teamId,
      userId: session.user.id,
    }),
    listTeamDigestDestinations(db, active.teamId),
  ]);
  const inboundEmailSettings: InboundEmailWhitelistSettings = (
    await db
      .select({
        inboundEmail: teams.inboundEmail,
        enabled: teams.inboundSenderWhitelistEnabled,
        senders: teams.inboundSenderWhitelist,
      })
      .from(teams)
      .where(eq(teams.id, active.teamId))
      .limit(1)
  )[0] ?? { inboundEmail: null, enabled: false, senders: [] };
  const inboundEmail = displayInboundEmail(
    { slug: active.teamSlug, inboundEmail: inboundEmailSettings.inboundEmail },
    process.env.POSTMARK_INBOUND_ADDRESS,
  );
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
  const destinationOptions = isAdmin ? await digestDestinationOptions(active.teamId) : [];

  return (
    <div className="space-y-4">
      <PageHeader
        variant="collection"
        title="Team"
        subtitle="Manage members, defaults, and access."
        srLabel={`Team ${active.teamName} · your role: ${role} · ${memberRows.length} members`}
        metadata={[
          { label: 'Team', value: active.teamName },
          { label: 'Role', value: role },
          { label: 'Members', value: memberRows.length, mono: true },
        ]}
      />
      <div className="flex flex-col gap-5 lg:flex-row lg:gap-8">
        <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <SettingsNav items={[...SETTINGS_ITEMS]} activeSection={section} isAdmin={isAdmin} />
        </aside>
        <div className="min-w-0 flex-1 space-y-5">
          {section === 'members' ? (
            <>
              <TeamMembersSettings
                members={memberRows}
                userMap={userMap}
                isAdmin={isAdmin}
                isOwner={isOwner}
                currentUserId={session.user.id}
                invites={inviteRows}
                removedMembers={removedRows}
              />
            </>
          ) : null}
          {section === 'general' ? (
            <SettingsSection title="Team identity">
              {isAdmin ? (
                <RenameTeamForm currentName={active.teamName} teamId={active.teamId} />
              ) : (
                <p className="text-sm text-fg-muted">
                  Only team administrators can rename this team.
                </p>
              )}
            </SettingsSection>
          ) : null}
          {section === 'preferences' ? (
            <>
              <MessagingPreferencesCard enabled={digestPreference.enabled} />
              {isAdmin ? (
                <SettingsSection title="Digest destinations">
                  <DigestDestinationsForm
                    destinations={digestDestinations}
                    options={destinationOptions}
                  />
                </SettingsSection>
              ) : null}
              {isAdmin ? (
                <SettingsSection title="Team timezone">
                  <TeamTimezoneForm {...timezoneSettings} />
                </SettingsSection>
              ) : null}
            </>
          ) : null}
          {section === 'visibility' ? (
            <SettingsSection title="Visibility defaults">
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
            </SettingsSection>
          ) : null}
          {section === 'email' ? (
            <SettingsSection title="Team email">
              {isAdmin ? (
                <InboundEmailWhitelistForm {...inboundEmailSettings} inboundEmail={inboundEmail} />
              ) : (
                <div className="space-y-3">
                  <CopyableTextField
                    id="team-inbound-email"
                    label="Team email address"
                    value={inboundEmail}
                    copyLabel="Copy team email"
                    description="Forward, CC, or BCC mail to this address to capture it on the timeline."
                  />
                  <p className="text-sm text-fg-muted">
                    Only team administrators can change the sender whitelist.
                  </p>
                </div>
              )}
            </SettingsSection>
          ) : null}
          {section === 'exports' ? (
            <SettingsSection title="Team export">
              {isAdmin ? (
                <TeamExportPanel exports={exportRows} downloadError={query.exportError} />
              ) : (
                <p className="text-sm text-fg-muted">
                  Only team administrators can create exports.
                </p>
              )}
            </SettingsSection>
          ) : null}
          {section === 'advanced' && isAdmin ? <AdminShortcuts isAdmin /> : null}
        </div>
      </div>
    </div>
  );
}

function MessagingPreferencesCard({ enabled }: { enabled: boolean }) {
  return (
    <SettingsSection title="Messaging">
      <DigestPreferenceForm enabled={enabled} />
    </SettingsSection>
  );
}

function AdminShortcuts({ isAdmin }: { isAdmin: boolean }) {
  if (!isAdmin) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-y border-border py-1.5">
      <ActionChip href="/app/team/jobs" label="Job recovery" />
      <ActionChip href="/app/team/reconciliation" label="Reconciliation" />
      <ActionChip href="/app/team/audit" label="Audit" />
      <ActionChip href="/app/team/integrations/audit" label="Integration audit" />
    </div>
  );
}

async function digestDestinationOptions(teamId: string): Promise<DigestDestinationOption[]> {
  const options: DigestDestinationOption[] = [
    { kind: 'email_members', label: 'Email every member' },
  ];
  const env = getEnv();
  const slackInstalled = await hasSlackInstallForTeam({ db, teamId });
  if (slackInstalled) {
    options.push({ kind: 'slack_dm_members', label: 'Slack DM every linked member' });
    try {
      const conversations = await listSlackConversationsForTeam({ db, teamId });
      for (const conversation of conversations.filter((row) => row.is_member !== false)) {
        const name = conversation.name ? `#${conversation.name}` : conversation.id;
        options.push({
          kind: 'slack_channel',
          targetId: conversation.id,
          label: `Slack ${name}`,
        });
      }
    } catch {
      // Channel picker stays empty when Slack listing fails; DMs remain available.
    }
  }
  if (env.TELEGRAM_BOT_TOKEN) {
    options.push({ kind: 'telegram_dm_members', label: 'Telegram DM every linked member' });
    const chats = await db
      .select({
        chatId: telegramChatBindings.tgChatId,
        title: telegramChatBindings.title,
      })
      .from(telegramChatBindings)
      .where(eq(telegramChatBindings.teamId, teamId));
    for (const chat of chats) {
      options.push({
        kind: 'telegram_chat',
        targetId: String(chat.chatId),
        label: `Telegram · ${chat.title ?? chat.chatId}`,
      });
    }
  }
  return options;
}
