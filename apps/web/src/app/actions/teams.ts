'use server';

import {
  auditLog,
  messagePreferences,
  teamCalendarSettings,
  teamInvites,
  teamMembers,
  teams,
  telegramChatBindings,
  users,
} from '@timeline/db';
import { createOwnedWorkspace } from '@timeline/shared/agent-provisioning';
import {
  assertTeamMemberSeatCapacity,
  expiredInviteNeedsSeat,
  isBillingAdmissionError,
} from '@timeline/shared/billing';
import { getEnv } from '@timeline/shared/env';
import {
  addTeamDigestDestination,
  parseAddDigestDestinationInput,
  removeTeamDigestDestination,
  sendMessage,
  type AddDigestDestinationInput,
} from '@timeline/shared/messaging';
import { hasSlackInstallForTeam, listSlackConversationsForTeam } from '@timeline/shared/slack';
import { randomToken } from '@timeline/shared/slug';
import { withTeam } from '@timeline/shared/team-scope';
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  ACTIVE_TEAM_COOKIE,
  activeTeamCookieOptions,
  resolveActiveTeam,
  serializeActiveTeamCookie,
} from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { CONNECTIONS_HREF, CONNECTIONS_LEGACY_HREF } from '@/lib/connections';
import { db } from '@/lib/db';
import { safeMarkOnboardingStep } from '@/lib/onboarding';
import { changeMemberRole, removeMember } from '@/lib/platform-membership';
import { runSentryServerAction } from '@/lib/sentry-action';
import { reportCaughtError } from '@/lib/sentry-report';
import { getSiteUrl } from '@/lib/site-url';
import { normalizeTimezone } from '@/lib/timezones';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const createTeamSchema = z.object({
  name: z.string().min(1).max(80),
  timezone: z.string().optional(),
});
const renameTeamSchema = z.object({
  teamId: z.uuid(),
  name: z.string().trim().min(1).max(80),
});
const updateTeamTimezoneSchema = z.object({
  timezone: z.string().trim().min(1).max(100),
});
const emailListSchema = z.array(z.email());

export interface CreateTeamState {
  error?: string;
}

export async function createTeamAction(
  _prev: CreateTeamState,
  formData: FormData,
): Promise<CreateTeamState> {
  return runSentryServerAction('create_team', async () => {
    const session = await auth();
    if (!session?.user) return { error: 'Not signed in' };

    const parsed = createTeamSchema.safeParse({
      name: formData.get('name'),
      timezone: formData.get('timezone') ?? undefined,
    });
    if (!parsed.success) return { error: 'Invalid team name' };
    const defaultTimezone = normalizeTimezone(parsed.data.timezone);

    let teamId: string;
    try {
      const result = await db.transaction((tx) =>
        createOwnedWorkspace(tx, {
          ownerId: session.user.id,
          name: parsed.data.name,
          timezone: defaultTimezone,
        }),
      );
      teamId = result.team.id;
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'create_team' });
      return { error: 'Failed to create team' };
    }

    const cookieStore = await cookies();
    cookieStore.set(
      ACTIVE_TEAM_COOKIE,
      serializeActiveTeamCookie(teamId),
      activeTeamCookieOptions(),
    );
    trackProductEventBestEffort({ kind: 'user', userId: session.user.id, teamId }, 'team_created', {
      source: 'manual',
    });
    revalidatePath('/app');
    redirect('/app/timeline');
  });
}

export interface RenameTeamState {
  error?: string;
  ok?: boolean;
}

export async function renameTeamAction(
  _prev: RenameTeamState,
  formData: FormData,
): Promise<RenameTeamState> {
  return runSentryServerAction('rename_team', async () => {
    const session = await auth();
    if (!session?.user) return { error: 'Not signed in' };

    const parsed = renameTeamSchema.safeParse({
      teamId: formData.get('teamId'),
      name: formData.get('name'),
    });
    if (!parsed.success) return { error: 'Invalid team name' };

    const scope = withTeam(db, parsed.data.teamId, session.user.id);
    try {
      await scope.requireMembership('admin');
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'rename_team_auth' });
      return { error: 'Only admins can rename a team' };
    }

    let changed: boolean;
    try {
      changed = await db.transaction(async (tx) => {
        const updated = await tx
          .update(teams)
          .set({ name: parsed.data.name })
          .where(and(eq(teams.id, parsed.data.teamId), ne(teams.name, parsed.data.name)))
          .returning({ id: teams.id });
        if (!updated[0]) return false;
        await tx.insert(auditLog).values({
          teamId: parsed.data.teamId,
          actorUserId: session.user.id,
          action: 'settings.change',
          targetType: 'team',
          targetId: parsed.data.teamId,
          targetVisibility: 'team',
          metadata: { setting: 'team.name' },
        });
        return true;
      });
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'rename_team' });
      return { error: 'Failed to rename team' };
    }

    if (!changed) return { ok: true };
    trackProductEventBestEffort(
      { kind: 'user', userId: session.user.id, teamId: parsed.data.teamId },
      'team_management_action_completed',
      { action: 'settings_update' },
    );

    revalidatePath('/app', 'layout');
    revalidatePath('/app/team');
    return { ok: true };
  });
}

export interface InboundEmailWhitelistState {
  error?: string;
  ok?: boolean;
}

export interface DigestPreferenceState {
  error?: string;
  ok?: boolean;
}

export interface DigestDestinationState {
  error?: string;
  ok?: boolean;
}

export interface TeamTimezoneState {
  error?: string;
  ok?: boolean;
}

function parseSenderWhitelist(raw: FormDataEntryValue | null): string[] | null {
  if (typeof raw !== 'string') return [];
  const items = raw
    .split(/[\n,]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  const deduped = Array.from(new Set(items));
  const parsed = emailListSchema.safeParse(deduped);
  return parsed.success ? parsed.data : null;
}

function parseDisabledSenderWhitelist(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== 'string') return [];
  const out = new Set<string>();
  for (const item of raw.split(/[\n,]+/)) {
    const email = item.trim().toLowerCase();
    if (z.email().safeParse(email).success) out.add(email);
  }
  return Array.from(out);
}

export async function updateInboundEmailWhitelistAction(
  _prev: InboundEmailWhitelistState,
  formData: FormData,
): Promise<InboundEmailWhitelistState> {
  return runSentryServerAction('update_inbound_email_whitelist', async () => {
    const session = await auth();
    if (!session?.user) return { error: 'Not signed in' };
    const { active } = await resolveActiveTeam(session.user.id);
    if (!active) return { error: 'No active team' };

    const enabled = formData.get('enabled') === 'on';
    const rawSenders = formData.get('senders');
    const whitelist = enabled
      ? parseSenderWhitelist(rawSenders)
      : parseDisabledSenderWhitelist(rawSenders);
    if (!whitelist) return { error: 'Enter valid email addresses only' };

    const scope = withTeam(db, active.teamId, session.user.id);
    try {
      await scope.requireMembership('admin');
    } catch (err) {
      reportCaughtError(err, {
        surface: 'server_action',
        operation: 'update_inbound_email_whitelist_auth',
      });
      return { error: 'Only admins can update email ingest settings' };
    }

    let changed: boolean;
    try {
      changed = await db.transaction(async (tx) => {
        const updated = await tx
          .update(teams)
          .set({
            inboundSenderWhitelistEnabled: enabled,
            inboundSenderWhitelist: whitelist,
          })
          .where(
            and(
              eq(teams.id, active.teamId),
              or(
                ne(teams.inboundSenderWhitelistEnabled, enabled),
                sql<boolean>`${teams.inboundSenderWhitelist} IS DISTINCT FROM ${JSON.stringify(whitelist)}::jsonb`,
              ),
            ),
          )
          .returning({ id: teams.id });
        if (!updated[0]) return false;
        await tx.insert(auditLog).values({
          teamId: active.teamId,
          actorUserId: session.user.id,
          action: 'settings.change',
          targetType: 'team',
          targetId: active.teamId,
          targetVisibility: 'team',
          metadata: {
            setting: 'team.inbound_sender_whitelist',
            enabled,
            senderCount: whitelist.length,
          },
        });
        return true;
      });
    } catch (err) {
      reportCaughtError(err, {
        surface: 'server_action',
        operation: 'update_inbound_email_whitelist',
      });
      return { error: 'Failed to update email sender whitelist' };
    }

    if (!changed) return { ok: true };
    trackProductEventBestEffort(
      { kind: 'user', userId: session.user.id, teamId: active.teamId },
      'team_management_action_completed',
      { action: 'settings_update' },
    );

    revalidatePath('/app/team');
    revalidatePath('/app/connect-agent');
    revalidatePath(CONNECTIONS_HREF, 'layout');
    revalidatePath(CONNECTIONS_LEGACY_HREF);
    return { ok: true };
  });
}

export async function updateDigestPreferenceAction(
  _prev: DigestPreferenceState,
  formData: FormData,
): Promise<DigestPreferenceState> {
  return runSentryServerAction('update_digest_preference', async () => {
    const session = await auth();
    if (!session?.user) return { error: 'Not signed in' };
    const { active } = await resolveActiveTeam(session.user.id);
    if (!active) return { error: 'No active team' };

    const scope = withTeam(db, active.teamId, session.user.id);
    try {
      await scope.requireMembership();
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'digest_preference_auth' });
      return { error: 'You are not a member of this team' };
    }

    const enabled = formData.get('dailyDigestEnabled') === 'on';
    const existing = await db
      .select({
        id: messagePreferences.id,
        dailyDigestEnabled: messagePreferences.dailyDigestEnabled,
      })
      .from(messagePreferences)
      .where(
        and(
          eq(messagePreferences.teamId, active.teamId),
          eq(messagePreferences.userId, session.user.id),
        ),
      )
      .limit(1);

    const preference = existing[0];
    const changed = preference ? preference.dailyDigestEnabled !== enabled : !enabled;
    if (!changed) return { ok: true };

    if (preference) {
      await db
        .update(messagePreferences)
        .set({ dailyDigestEnabled: enabled, updatedAt: new Date() })
        .where(eq(messagePreferences.id, preference.id));
    } else {
      const calendarSettings = await scope.calendar.getCalendarSettings();
      await db.insert(messagePreferences).values({
        teamId: active.teamId,
        userId: session.user.id,
        dailyDigestEnabled: enabled,
        dailyDigestHour: 12,
        timezone: calendarSettings.defaultTimezone,
      });
    }

    await safeMarkOnboardingStep(scope, 'daily_digest');
    trackProductEventBestEffort(
      { kind: 'user', userId: session.user.id, teamId: active.teamId },
      'team_management_action_completed',
      { action: 'settings_update' },
    );
    revalidatePath('/app');
    revalidatePath('/app/team');
    return { ok: true };
  });
}

function splitDestinationTarget(raw: FormDataEntryValue | null): {
  targetId?: string;
  label?: string;
} {
  if (typeof raw !== 'string' || raw.trim().length === 0) return {};
  const [targetId, ...labelParts] = raw.split('::');
  const label = labelParts.join('::').trim();
  return {
    ...(targetId?.trim() ? { targetId: targetId.trim() } : {}),
    ...(label ? { label } : {}),
  };
}

async function assertDigestDestinationAvailable(
  teamId: string,
  destination: AddDigestDestinationInput,
): Promise<string | null> {
  if (destination.kind === 'slack_channel' || destination.kind === 'slack_dm_members') {
    if (!(await hasSlackInstallForTeam({ db, teamId }))) {
      return 'Connect Slack before adding a Slack digest destination.';
    }
  }
  if (destination.kind === 'telegram_chat' || destination.kind === 'telegram_dm_members') {
    if (!getEnv().TELEGRAM_BOT_TOKEN) {
      return 'Connect Telegram before adding a Telegram digest destination.';
    }
  }
  if (destination.kind === 'telegram_chat') {
    const chatId = Number(destination.targetId);
    if (!Number.isSafeInteger(chatId)) {
      return 'That Telegram chat is not bound to this team.';
    }
    const rows = await db
      .select({ id: telegramChatBindings.id })
      .from(telegramChatBindings)
      .where(
        and(eq(telegramChatBindings.teamId, teamId), eq(telegramChatBindings.tgChatId, chatId)),
      )
      .limit(1);
    if (!rows[0]) return 'That Telegram chat is not bound to this team.';
  }
  if (destination.kind === 'slack_channel') {
    try {
      const conversations = await listSlackConversationsForTeam({ db, teamId });
      const match = conversations.find(
        (conversation) =>
          conversation.id === destination.targetId && conversation.is_member !== false,
      );
      if (!match) return 'The Slack bot must be a member of that channel.';
    } catch (err) {
      reportCaughtError(err, {
        surface: 'server_action',
        operation: 'add_digest_destination_slack_channel',
      });
      return 'Could not verify that Slack channel.';
    }
  }
  return null;
}

export async function addDigestDestinationAction(
  _prev: DigestDestinationState,
  formData: FormData,
): Promise<DigestDestinationState> {
  return runSentryServerAction('add_digest_destination', async () => {
    const session = await auth();
    if (!session?.user) return { error: 'Not signed in' };
    const { active } = await resolveActiveTeam(session.user.id);
    if (!active) return { error: 'No active team' };

    const scope = withTeam(db, active.teamId, session.user.id);
    try {
      await scope.requireMembership('admin');
    } catch (err) {
      reportCaughtError(err, {
        surface: 'server_action',
        operation: 'add_digest_destination_auth',
      });
      return { error: 'Only admins can change digest destinations' };
    }

    const parsed = parseAddDigestDestinationInput({
      kind: formData.get('kind'),
      ...splitDestinationTarget(formData.get('target')),
    });
    if (!parsed.ok) return { error: parsed.error };

    const unavailable = await assertDigestDestinationAvailable(active.teamId, parsed.value);
    if (unavailable) return { error: unavailable };

    const result = await addTeamDigestDestination({
      db,
      teamId: active.teamId,
      createdByUserId: session.user.id,
      destination: parsed.value,
    });
    if ('error' in result) return { error: result.error };

    await db.insert(auditLog).values({
      teamId: active.teamId,
      actorUserId: session.user.id,
      action: 'settings.change',
      targetType: 'team',
      targetId: active.teamId,
      targetVisibility: 'team',
      metadata: {
        setting: 'team.digest.destination.add',
        kind: parsed.value.kind,
        targetId: parsed.value.targetId ?? null,
      },
    });

    trackProductEventBestEffort(
      { kind: 'user', userId: session.user.id, teamId: active.teamId },
      'team_management_action_completed',
      { action: 'settings_update' },
    );

    revalidatePath('/app/team');
    return { ok: true };
  });
}

export async function removeDigestDestinationAction(
  _prev: DigestDestinationState,
  formData: FormData,
): Promise<DigestDestinationState> {
  return runSentryServerAction('remove_digest_destination', async () => {
    const session = await auth();
    if (!session?.user) return { error: 'Not signed in' };
    const { active } = await resolveActiveTeam(session.user.id);
    if (!active) return { error: 'No active team' };

    const scope = withTeam(db, active.teamId, session.user.id);
    try {
      await scope.requireMembership('admin');
    } catch (err) {
      reportCaughtError(err, {
        surface: 'server_action',
        operation: 'remove_digest_destination_auth',
      });
      return { error: 'Only admins can change digest destinations' };
    }

    const destinationId = formData.get('destinationId');
    if (typeof destinationId !== 'string' || !z.uuid().safeParse(destinationId).success) {
      return { error: 'Choose a digest destination to remove.' };
    }

    const removed = await removeTeamDigestDestination({
      db,
      teamId: active.teamId,
      destinationId,
    });
    if (!removed) return { error: 'That digest destination was already removed.' };

    await db.insert(auditLog).values({
      teamId: active.teamId,
      actorUserId: session.user.id,
      action: 'settings.change',
      targetType: 'team',
      targetId: active.teamId,
      targetVisibility: 'team',
      metadata: {
        setting: 'team.digest.destination.remove',
        destinationId,
      },
    });

    trackProductEventBestEffort(
      { kind: 'user', userId: session.user.id, teamId: active.teamId },
      'team_management_action_completed',
      { action: 'settings_update' },
    );

    revalidatePath('/app/team');
    return { ok: true };
  });
}

export async function updateTeamTimezoneAction(
  _prev: TeamTimezoneState,
  formData: FormData,
): Promise<TeamTimezoneState> {
  return runSentryServerAction('update_team_timezone', async () => {
    const session = await auth();
    if (!session?.user) return { error: 'Not signed in' };
    const { active } = await resolveActiveTeam(session.user.id);
    if (!active) return { error: 'No active team' };

    const parsed = updateTeamTimezoneSchema.safeParse({
      timezone: formData.get('timezone'),
    });
    if (!parsed.success || normalizeTimezone(parsed.data.timezone) !== parsed.data.timezone) {
      return { error: 'Choose a valid timezone' };
    }

    const scope = withTeam(db, active.teamId, session.user.id);
    try {
      await scope.requireMembership('admin');
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'update_team_timezone_auth' });
      return { error: 'Only admins can update team timezone' };
    }

    try {
      const current = await scope.calendar.getCalendarSettings();
      if (current.defaultTimezone === parsed.data.timezone) return { ok: true };
      await db.transaction(async (tx) => {
        const updatedAt = new Date();
        await tx
          .insert(teamCalendarSettings)
          .values({
            teamId: active.teamId,
            defaultTimezone: parsed.data.timezone,
            updatedAt,
          })
          .onConflictDoUpdate({
            target: teamCalendarSettings.teamId,
            set: { defaultTimezone: parsed.data.timezone, updatedAt },
          });
        await tx
          .update(messagePreferences)
          .set({ timezone: parsed.data.timezone, updatedAt })
          .where(eq(messagePreferences.teamId, active.teamId));
        await tx.insert(auditLog).values({
          teamId: active.teamId,
          actorUserId: session.user.id,
          action: 'settings.change',
          targetType: 'team',
          targetId: active.teamId,
          targetVisibility: 'team',
          metadata: {
            setting: 'team.calendar.default_timezone',
            timezone: parsed.data.timezone,
          },
        });
      });
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'update_team_timezone' });
      return { error: 'Failed to update team timezone' };
    }

    trackProductEventBestEffort(
      { kind: 'user', userId: session.user.id, teamId: active.teamId },
      'team_management_action_completed',
      { action: 'settings_update' },
    );

    revalidatePath('/app', 'layout');
    revalidatePath('/app/team');
    revalidatePath('/app/calendar');
    revalidatePath('/app/meetings');
    revalidatePath('/app/timeline');
    revalidatePath('/app/approvals');
    return { ok: true };
  });
}

const inviteSchema = z.object({
  email: z.email().toLowerCase(),
  role: z.enum(['admin', 'member']).default('member'),
});

export interface InviteState {
  error?: string;
  inviteUrl?: string;
  sendStatus?: 'pending' | 'sent' | 'failed';
  sendError?: string;
}

export interface TeamMutationResult {
  error?: string;
  ok?: boolean;
}

interface InviteDeliveryInput {
  id: string;
  teamId: string;
  inviterUserId: string;
  email: string;
  role: 'admin' | 'member';
  token: string;
  expiresAt: Date;
  teamName: string;
  inviterName: string;
}

function inviteUrl(token: string): string {
  return `${getSiteUrl()}/accept-invite/${token}`;
}

async function deliverInviteEmail(input: InviteDeliveryInput): Promise<InviteState> {
  const url = inviteUrl(input.token);
  const result = await sendMessage(
    'team_invite',
    {
      to: input.email,
      inviterName: input.inviterName,
      teamName: input.teamName,
      role: input.role,
      inviteUrl: url,
      expiresAt: input.expiresAt,
    },
    {
      db,
      teamId: input.teamId,
      userId: input.inviterUserId,
      dedupeKey: `team_invite:${input.id}:${input.token}`,
      metadata: { inviteId: input.id, role: input.role },
    },
  );
  if (result.ok && !result.skipped) {
    await db
      .update(teamInvites)
      .set({ sendStatus: 'sent', sendError: null, lastSentAt: new Date() })
      .where(eq(teamInvites.id, input.id));
    return { inviteUrl: url, sendStatus: 'sent' };
  }
  if (result.ok && result.skipped) {
    return { inviteUrl: url };
  }
  const sendError = result.error ?? 'Failed to send invite email';
  await db
    .update(teamInvites)
    .set({ sendStatus: 'failed', sendError, lastSentAt: new Date() })
    .where(eq(teamInvites.id, input.id));
  return { inviteUrl: url, sendStatus: 'failed', sendError };
}

export async function inviteMemberAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  return runSentryServerAction('invite_member', async () => {
    const session = await auth();
    if (!session?.user) return { error: 'Not signed in' };
    const { active } = await resolveActiveTeam(session.user.id);
    if (!active) return { error: 'No active team' };

    const parsed = inviteSchema.safeParse({
      email: formData.get('email'),
      role: formData.get('role') ?? 'member',
    });
    if (!parsed.success) return { error: 'Invalid email' };

    const scope = withTeam(db, active.teamId, session.user.id);
    let callerRole: 'owner' | 'admin' | 'member';
    try {
      callerRole = await scope.requireMembership('admin');
      if (parsed.data.role === 'admin' && callerRole !== 'owner') {
        return { error: 'Only owners can invite admins' };
      }
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'invite_member_auth' });
      return { error: 'Only admins can invite' };
    }

    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const inviterName = session.user.name ?? session.user.email ?? 'A teammate';
    let delivery: InviteDeliveryInput;
    try {
      delivery = await db.transaction(async (tx) => {
        const activeMembers = await tx
          .select({ userId: teamMembers.userId })
          .from(users)
          .innerJoin(teamMembers, eq(teamMembers.userId, users.id))
          .where(
            and(
              eq(teamMembers.teamId, active.teamId),
              isNull(teamMembers.removedAt),
              sql`lower(${users.email}) = ${parsed.data.email}`,
            ),
          )
          .limit(1);
        if (activeMembers[0]) throw new Error('already-member');

        const openInvites = await tx
          .select({
            id: teamInvites.id,
            role: teamInvites.role,
            expiresAt: teamInvites.expiresAt,
          })
          .from(teamInvites)
          .where(
            and(
              eq(teamInvites.teamId, active.teamId),
              sql`lower(${teamInvites.email}) = ${parsed.data.email}`,
              isNull(teamInvites.acceptedAt),
              isNull(teamInvites.revokedAt),
            ),
          )
          .limit(1)
          .for('update');
        const existing = openInvites[0];
        if (existing?.role === 'admin' && callerRole !== 'owner') {
          throw new Error('admin-invite-owned-by-owner');
        }
        await assertTeamMemberSeatCapacity({
          db: tx as unknown as typeof db,
          teamId: active.teamId,
          additionalSeats: !existing || expiredInviteNeedsSeat(existing.expiresAt) ? 1 : 0,
        });
        const rows = existing
          ? await tx
              .update(teamInvites)
              .set({
                role: parsed.data.role,
                token,
                invitedByUserId: session.user.id,
                expiresAt,
                sendStatus: 'pending',
                sendError: null,
                lastSentAt: null,
              })
              .where(eq(teamInvites.id, existing.id))
              .returning({ id: teamInvites.id })
          : await tx
              .insert(teamInvites)
              .values({
                teamId: active.teamId,
                email: parsed.data.email,
                role: parsed.data.role,
                token,
                invitedByUserId: session.user.id,
                expiresAt,
                sendStatus: 'pending',
              })
              .returning({ id: teamInvites.id });
        const id = rows[0]?.id;
        if (!id) throw new Error('invite-write-failed');
        await tx.insert(auditLog).values({
          teamId: active.teamId,
          actorUserId: session.user.id,
          action: 'settings.change',
          targetType: 'team',
          targetId: active.teamId,
          targetVisibility: 'team',
          metadata: {
            setting: existing ? 'team.invite_updated' : 'team.invite',
            inviteId: id,
            role: parsed.data.role,
          },
        });
        return {
          id,
          teamId: active.teamId,
          inviterUserId: session.user.id,
          email: parsed.data.email,
          role: parsed.data.role,
          token,
          expiresAt,
          teamName: active.teamName,
          inviterName,
        };
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'already-member') {
        return {
          error: 'This person is already a member. Change their role from the members list.',
        };
      }
      if (err instanceof Error && err.message === 'admin-invite-owned-by-owner') {
        return { error: 'Only owners can change an admin invite for this email.' };
      }
      if (isBillingAdmissionError(err)) {
        return {
          error:
            'This plan’s member limit is reached. Add a payment method or choose a larger plan to invite more people.',
        };
      }
      reportCaughtError(err, { surface: 'server_action', operation: 'invite_member' });
      return { error: 'Failed to create invite' };
    }

    trackProductEventBestEffort(
      { kind: 'user', userId: session.user.id, teamId: active.teamId },
      'team_management_action_completed',
      { action: 'invite_create' },
    );
    const result = await deliverInviteEmail(delivery);
    revalidatePath('/app/team');
    return result;
  });
}

export async function resendInviteAction(formData: FormData): Promise<TeamMutationResult> {
  return runSentryServerAction('resend_invite', async () => {
    const session = await auth();
    if (!session?.user) return { error: 'Not signed in' };
    const { active } = await resolveActiveTeam(session.user.id);
    if (!active) return { error: 'No active team' };
    const inviteId = formData.get('inviteId');
    if (typeof inviteId !== 'string') return { error: 'Invite is missing' };

    const scope = withTeam(db, active.teamId, session.user.id);
    const callerRole = await scope.requireMembership('admin');
    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const inviterName = session.user.name ?? session.user.email ?? 'A teammate';
    let delivery: { ok: true; input: InviteDeliveryInput } | TeamMutationResult;
    try {
      delivery = await db.transaction(
        async (tx): Promise<{ ok: true; input: InviteDeliveryInput } | TeamMutationResult> => {
          const rows = await tx
            .select({
              id: teamInvites.id,
              email: teamInvites.email,
              role: teamInvites.role,
              expiresAt: teamInvites.expiresAt,
            })
            .from(teamInvites)
            .where(
              and(
                eq(teamInvites.id, inviteId),
                eq(teamInvites.teamId, active.teamId),
                isNull(teamInvites.acceptedAt),
                isNull(teamInvites.revokedAt),
              ),
            )
            .limit(1)
            .for('update');
          const invite = rows[0];
          if (!invite) return { error: 'Invite is no longer available' };
          if (invite.role === 'owner') return { error: 'This invite cannot be resent' };
          if (invite.role === 'admin' && callerRole !== 'owner') {
            return { error: 'Only owners can resend admin invites' };
          }
          await assertTeamMemberSeatCapacity({
            db: tx as unknown as typeof db,
            teamId: active.teamId,
            additionalSeats: expiredInviteNeedsSeat(invite.expiresAt) ? 1 : 0,
          });
          await tx
            .update(teamInvites)
            .set({ token, expiresAt, sendStatus: 'pending', sendError: null, lastSentAt: null })
            .where(eq(teamInvites.id, invite.id));
          return {
            ok: true,
            input: {
              id: invite.id,
              teamId: active.teamId,
              inviterUserId: session.user.id,
              email: invite.email,
              role: invite.role,
              token,
              expiresAt,
              teamName: active.teamName,
              inviterName,
            },
          };
        },
      );
    } catch (err) {
      if (isBillingAdmissionError(err)) {
        return {
          error:
            'This plan’s member limit is reached. Add a payment method or choose a larger plan to invite more people.',
        };
      }
      throw err;
    }
    if (!('input' in delivery)) return { error: delivery.error ?? 'Couldn’t resend invite' };
    await deliverInviteEmail(delivery.input);
    revalidatePath('/app/team');
    return { ok: true };
  });
}

export async function revokeInviteAction(formData: FormData): Promise<TeamMutationResult> {
  return runSentryServerAction('revoke_invite', async () => {
    const session = await auth();
    if (!session?.user) return { error: 'Not signed in' };
    const { active } = await resolveActiveTeam(session.user.id);
    if (!active) return { error: 'No active team' };
    const inviteId = formData.get('inviteId');
    if (typeof inviteId !== 'string') return { error: 'Invite is missing' };

    const scope = withTeam(db, active.teamId, session.user.id);
    const callerRole = await scope.requireMembership('admin');
    const outcome = await db.transaction(async (tx): Promise<TeamMutationResult> => {
      const rows = await tx
        .select({ role: teamInvites.role })
        .from(teamInvites)
        .where(
          and(
            eq(teamInvites.id, inviteId),
            eq(teamInvites.teamId, active.teamId),
            isNull(teamInvites.acceptedAt),
            isNull(teamInvites.revokedAt),
          ),
        )
        .limit(1)
        .for('update');
      const invite = rows[0];
      if (!invite) return { error: 'Invite is no longer available' };
      if (invite.role === 'admin' && callerRole !== 'owner') {
        return { error: 'Only owners can revoke admin invites' };
      }
      await tx
        .update(teamInvites)
        .set({ revokedAt: new Date(), revokedByUserId: session.user.id })
        .where(eq(teamInvites.id, inviteId));
      await tx.insert(auditLog).values({
        teamId: active.teamId,
        actorUserId: session.user.id,
        action: 'settings.change',
        targetType: 'team',
        targetId: active.teamId,
        targetVisibility: 'team',
        metadata: { setting: 'team.invite_revoked', inviteId, role: invite.role },
      });
      return { ok: true };
    });
    if (outcome.error) return outcome;
    trackProductEventBestEffort(
      { kind: 'user', userId: session.user.id, teamId: active.teamId },
      'team_management_action_completed',
      { action: 'invite_revoke' },
    );
    revalidatePath('/app/team');
    return { ok: true };
  });
}

export async function changeMemberRoleAction(formData: FormData): Promise<TeamMutationResult> {
  return changeMemberRole(formData);
}
export async function removeMemberAction(formData: FormData): Promise<TeamMutationResult> {
  return removeMember(formData);
}
