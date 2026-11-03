import {
  auditLog,
  ingestWebhookCredentials,
  ingestWebhooks,
  integrations,
  rawEvents,
  slackConversationBindings,
  slackUserTeams,
  teamCalendarSubscriptions,
  teamMembers,
  teamVisibilityDefaults,
  telegramChatBindings,
  telegramUsers,
  telegramUserTeams,
} from '@timeline/db';
import {
  completePolarMembershipChange,
  lockTeamBillingIdentity,
  PolarIdentityError,
  synchronizePolarBillingUser,
  preparePolarMembershipChange,
  createPolarBillingProvider,
} from '@timeline/shared/billing';
import { releaseFreeGrantIfOwnerLeaves } from '@timeline/shared/billing';
import { resetSurfaceSessionsForTeamUserInTransaction } from '@timeline/shared/conversation-surfaces';
import * as integrationsLib from '@timeline/shared/integrations';
import {
  requirePlatformActor,
  recordPlatformAudit,
  type PlatformActor,
} from '@timeline/shared/platform-admin';
import { assertNotLastOwner } from '@timeline/shared/team-roles';
import { withTeam } from '@timeline/shared/team-scope';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import type { TeamMutationResult } from '@/app/actions/teams';
import type { Db } from '@timeline/db';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { runSentryServerAction } from '@/lib/sentry-action';
import { reportCaughtError } from '@/lib/sentry-report';

interface PlatformMembershipContext {
  actor: PlatformActor;
  teamId: string;
  reason: string;
}
export async function managePlatformMembership(
  input: PlatformMembershipContext & { userId: string; role: 'member' | 'admin' | 'removed' },
): Promise<TeamMutationResult> {
  await requirePlatformActor(db, input.actor);
  const form = new FormData();
  form.set('userId', input.userId);
  form.set('role', input.role);
  return input.role === 'removed' ? removeMember(form, input) : changeMemberRole(form, input);
}
export async function changeMemberRole(
  formData: FormData,
  platform?: PlatformMembershipContext,
): Promise<TeamMutationResult> {
  return runSentryServerAction('change_member_role', async () => {
    const session = platform ? { user: { id: platform.actor.userId } } : await auth();
    if (!session?.user) return { error: 'Not signed in' };
    const active = platform
      ? { teamId: platform.teamId }
      : (await resolveActiveTeam(session.user.id)).active;
    if (platform) await requirePlatformActor(db, platform.actor);
    if (!active) return { error: 'No active team' };
    const memberUserId = formData.get('userId');
    const role = formData.get('role');
    if (typeof memberUserId !== 'string') return { error: 'Choose a team member' };
    if (role !== 'owner' && role !== 'admin' && role !== 'member') {
      return { error: 'Choose a valid role' };
    }

    const scope = withTeam(db, active.teamId, session.user.id);
    try {
      if (!platform) await scope.requireMembership('owner');
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'change_member_role_auth' });
      return { error: 'Only owners can change roles' };
    }

    try {
      await preparePolarMembershipChange({
        db,
        teamId: active.teamId,
        actorUserId: session.user.id,
        userId: memberUserId,
        targetRole: role,
        provider: createPolarBillingProvider(),
        ...(platform ? { platformActor: platform.actor } : {}),
      });
      const outcome = await db.transaction(
        async (tx): Promise<TeamMutationResult & { changed?: boolean }> => {
          await lockTeamBillingIdentity(tx as unknown as Db, active.teamId);
          if (platform) await requirePlatformActor(tx as unknown as Db, platform.actor);
          const targetRows = await tx
            .select({ role: teamMembers.role })
            .from(teamMembers)
            .where(
              and(
                eq(teamMembers.teamId, active.teamId),
                eq(teamMembers.userId, memberUserId),
                isNull(teamMembers.removedAt),
              ),
            )
            .limit(1)
            .for('update');
          const target = targetRows[0];
          if (!target) return { error: 'That member is no longer on this team' };
          if (platform && (target.role === 'owner' || role === 'owner'))
            return { error: 'Owner roles cannot be changed here' };
          if (target.role === role) return { ok: true, changed: false };
          if (target.role === 'owner' && role !== 'owner') {
            await assertNotLastOwner(tx, active.teamId, memberUserId);
          }
          await completePolarMembershipChange(
            tx as unknown as Db,
            active.teamId,
            memberUserId,
            role,
          );
          await tx
            .update(teamMembers)
            .set({ role, authorizationEpoch: crypto.randomUUID() })
            .where(
              and(eq(teamMembers.teamId, active.teamId), eq(teamMembers.userId, memberUserId)),
            );
          if (target.role === 'owner' && role !== 'owner') {
            await releaseFreeGrantIfOwnerLeaves({
              db: tx,
              teamId: active.teamId,
              userId: memberUserId,
            });
          }
          if (platform)
            await recordPlatformAudit(tx as unknown as Db, {
              actorUserId: platform.actor.userId,
              teamId: active.teamId,
              targetId: memberUserId,
              action: 'membership.change',
              reason: platform.reason,
              metadata: { role: formData.get('role') ?? 'removed' },
            });
          await tx.insert(auditLog).values({
            teamId: active.teamId,
            actorUserId: session.user.id,
            action: 'settings.change',
            targetType: 'team',
            targetId: active.teamId,
            targetVisibility: 'team',
            metadata: {
              setting: 'team.member_role',
              memberUserId,
              previousRole: target.role,
              role,
            },
          });
          return { ok: true, changed: true };
        },
      );
      if (outcome.error) return outcome;
      if (!outcome.changed) return { ok: true };
      if (role === 'owner' || role === 'admin') {
        try {
          await synchronizePolarBillingUser({
            db,
            userId: memberUserId,
            provider: createPolarBillingProvider(),
          });
        } catch {
          return {
            error: 'Role saved. Billing access is pending a provider sync; retry from Billing.',
          };
        }
      }
    } catch (e) {
      if (e instanceof PolarIdentityError) return { error: e.message };
      if (e instanceof Error && e.message === 'last_owner') {
        reportCaughtError(e, { surface: 'server_action', operation: 'change_member_role' });
        return { error: 'The team needs at least one owner' };
      }
      throw e;
    }
    trackProductEventBestEffort(
      { kind: 'user', userId: session.user.id, teamId: active.teamId },
      'team_management_action_completed',
      { action: 'member_role_change' },
    );
    revalidatePath('/app/team');
    return { ok: true };
  });
}

export async function removeMember(
  formData: FormData,
  platform?: PlatformMembershipContext,
): Promise<TeamMutationResult> {
  return runSentryServerAction('remove_member', async () => {
    const session = platform ? { user: { id: platform.actor.userId } } : await auth();
    if (!session?.user) return { error: 'Not signed in' };
    const active = platform
      ? { teamId: platform.teamId }
      : (await resolveActiveTeam(session.user.id)).active;
    if (platform) await requirePlatformActor(db, platform.actor);
    if (!active) return { error: 'No active team' };
    const memberUserId = formData.get('userId');
    if (typeof memberUserId !== 'string') return { error: 'Choose a team member' };
    if (memberUserId === session.user.id) return { error: 'You can’t remove yourself' };

    const scope = withTeam(db, active.teamId, session.user.id);
    const callerRole = platform ? 'owner' : await scope.requireMembership('admin');
    const ownerLeftAttention: {
      providerConnectionId: string | null;
      integrationId: string;
    }[] = [];

    try {
      await preparePolarMembershipChange({
        db,
        teamId: active.teamId,
        actorUserId: session.user.id,
        userId: memberUserId,
        targetRole: 'removed',
        provider: createPolarBillingProvider(),
        ...(platform ? { platformActor: platform.actor } : {}),
      });
      const outcome = await db.transaction(async (tx): Promise<TeamMutationResult> => {
        await lockTeamBillingIdentity(tx as unknown as Db, active.teamId);
        if (platform) await requirePlatformActor(tx as unknown as Db, platform.actor);
        const targetRows = await tx
          .select({ role: teamMembers.role })
          .from(teamMembers)
          .where(
            and(
              eq(teamMembers.teamId, active.teamId),
              eq(teamMembers.userId, memberUserId),
              isNull(teamMembers.removedAt),
            ),
          )
          .limit(1)
          .for('update');
        const targetRole = targetRows[0]?.role;
        if (!targetRole) return { error: 'That member is no longer on this team' };
        if (platform && targetRole === 'owner') return { error: 'Owners cannot be removed here' };
        if (callerRole === 'admin' && targetRole !== 'member') {
          return { error: 'Only owners can remove admins or owners' };
        }
        if (callerRole !== 'owner' && callerRole !== 'admin') {
          return { error: 'Only admins can remove members' };
        }
        // Never strand a team with zero owners. `assertNotLastOwner` runs
        // SELECT FOR UPDATE on the team's owner rows so a concurrent removal
        // of a different owner cannot also pass this check.
        if (targetRole === 'owner') {
          await assertNotLastOwner(tx, active.teamId, memberUserId);
        }
        await completePolarMembershipChange(
          tx as unknown as Db,
          active.teamId,
          memberUserId,
          'removed',
        );
        await resetSurfaceSessionsForTeamUserInTransaction(tx, {
          teamId: active.teamId,
          userId: memberUserId,
        });
        await tx
          .update(teamMembers)
          .set({
            removedAt: new Date(),
            removedByUserId: session.user.id,
            authorizationEpoch: crypto.randomUUID(),
          })
          .where(and(eq(teamMembers.teamId, active.teamId), eq(teamMembers.userId, memberUserId)));
        if (targetRole === 'owner') {
          await releaseFreeGrantIfOwnerLeaves({
            db: tx,
            teamId: active.teamId,
            userId: memberUserId,
          });
        }
        await tx
          .delete(teamCalendarSubscriptions)
          .where(
            and(
              eq(teamCalendarSubscriptions.teamId, active.teamId),
              eq(teamCalendarSubscriptions.userId, memberUserId),
            ),
          );
        await tx
          .update(teamVisibilityDefaults)
          .set({
            sourceOwnerUserId: null,
            visibility: 'team',
            visibilityUserIds: null,
            updatedByUserId: session.user.id,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(teamVisibilityDefaults.teamId, active.teamId),
              eq(teamVisibilityDefaults.sourceOwnerUserId, memberUserId),
              eq(teamVisibilityDefaults.visibility, 'private'),
            ),
          );
        await tx
          .update(teamVisibilityDefaults)
          .set({ sourceOwnerUserId: null, updatedByUserId: session.user.id, updatedAt: new Date() })
          .where(
            and(
              eq(teamVisibilityDefaults.teamId, active.teamId),
              eq(teamVisibilityDefaults.sourceOwnerUserId, memberUserId),
            ),
          );
        const defaultRows = await tx
          .select({
            source: teamVisibilityDefaults.source,
            visibility: teamVisibilityDefaults.visibility,
            visibilityUserIds: teamVisibilityDefaults.visibilityUserIds,
          })
          .from(teamVisibilityDefaults)
          .where(
            and(
              eq(teamVisibilityDefaults.teamId, active.teamId),
              sql`${memberUserId}::uuid = ANY(${teamVisibilityDefaults.visibilityUserIds})`,
            ),
          );
        await Promise.all(
          defaultRows.map(async (row) => {
            const nextUserIds = (row.visibilityUserIds ?? []).filter((id) => id !== memberUserId);
            const nextVisibility =
              row.visibility === 'specific_users' && nextUserIds.length === 0
                ? 'team'
                : row.visibility;
            await tx
              .update(teamVisibilityDefaults)
              .set({
                visibility: nextVisibility,
                visibilityUserIds: nextUserIds.length > 0 ? nextUserIds : null,
                updatedByUserId: session.user.id,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(teamVisibilityDefaults.teamId, active.teamId),
                  eq(teamVisibilityDefaults.source, row.source),
                ),
              );
          }),
        );
        const integrationRows = await tx
          .select({
            id: integrations.id,
            connectedByUserId: integrations.connectedByUserId,
            providerConnectionId: integrations.providerConnectionId,
            visibilityDefault: integrations.visibilityDefault,
            visibilityDefaultUserIds: integrations.visibilityDefaultUserIds,
          })
          .from(integrations)
          .where(
            and(
              eq(integrations.teamId, active.teamId),
              or(
                eq(integrations.connectedByUserId, memberUserId),
                sql`${memberUserId}::uuid = ANY(${integrations.visibilityDefaultUserIds})`,
              ),
            ),
          );
        await Promise.all(
          integrationRows.map(async (row) => {
            const ownedByRemovedMember = row.connectedByUserId === memberUserId;
            const nextUserIds = ownedByRemovedMember
              ? []
              : (row.visibilityDefaultUserIds ?? []).filter((id) => id !== memberUserId);
            const nextVisibility = ownedByRemovedMember
              ? row.visibilityDefault === 'private' || row.visibilityDefault === 'specific_users'
                ? 'team'
                : row.visibilityDefault
              : row.visibilityDefault === 'specific_users' && nextUserIds.length === 0
                ? 'team'
                : row.visibilityDefault;
            await tx
              .update(integrations)
              .set({
                visibilityDefault: nextVisibility,
                visibilityDefaultUserIds: nextUserIds.length > 0 ? nextUserIds : null,
                ...(ownedByRemovedMember
                  ? {
                      enabled: false,
                      lastError: 'Connection owner left team — choose a replacement connection',
                    }
                  : {}),
                updatedAt: new Date(),
              })
              .where(eq(integrations.id, row.id));
            if (ownedByRemovedMember) {
              ownerLeftAttention.push({
                providerConnectionId: row.providerConnectionId,
                integrationId: row.id,
              });
            }
          }),
        );
        const webhookRows = await tx
          .select({
            id: ingestWebhooks.id,
            visibilityDefault: ingestWebhooks.visibilityDefault,
          })
          .from(ingestWebhooks)
          .where(
            and(
              eq(ingestWebhooks.teamId, active.teamId),
              eq(ingestWebhooks.ownerUserId, memberUserId),
              isNull(ingestWebhooks.disabledAt),
            ),
          );
        await Promise.all(
          webhookRows.map(async (row) => {
            const disabledAt = new Date();
            await tx
              .update(ingestWebhooks)
              .set({
                ownerUserId: null,
                visibilityDefault:
                  row.visibilityDefault === 'private' ? 'team' : row.visibilityDefault,
                disabledAt,
                updatedAt: disabledAt,
              })
              .where(eq(ingestWebhooks.id, row.id));
            await tx
              .update(ingestWebhookCredentials)
              .set({ revokedAt: disabledAt, updatedAt: disabledAt })
              .where(
                and(
                  eq(ingestWebhookCredentials.teamId, active.teamId),
                  eq(ingestWebhookCredentials.webhookId, row.id),
                  isNull(ingestWebhookCredentials.revokedAt),
                ),
              );
            await tx
              .update(rawEvents)
              .set({
                visibility: 'team',
                visibilityOwnerUserId: null,
                visibilityUserIds: null,
              })
              .where(
                and(
                  eq(rawEvents.teamId, active.teamId),
                  eq(rawEvents.source, 'ingest_webhook'),
                  eq(rawEvents.visibility, 'private'),
                  eq(rawEvents.visibilityOwnerUserId, memberUserId),
                  sql`${rawEvents.sourceMetadata} ->> 'ingest_webhook_id' = ${row.id}`,
                ),
              );
          }),
        );
        // Revoke Telegram routing for this user — two anchors, both needed:
        //
        //   1. Consumer-side: telegram_users.user_id points at this app
        //      user (bound at /link time, after the username-match identity
        //      check). Any telegram_user_teams row keyed by such a
        //      telegram_users.id is *their* DM. This is the primary anchor.
        //   2. Provenance-side: rows where linked_by_user_id matches —
        //      catches edge cases like a teammate consuming an admin's token
        //      under a different TG account (rejected at consumption now,
        //      but the historical cleanup stays as defense in depth).
        //
        // Also drop group bindings they personally established.
        const ownedTgUserIds = await tx
          .select({ id: telegramUsers.id })
          .from(telegramUsers)
          .where(eq(telegramUsers.userId, memberUserId));
        const ownedIds = ownedTgUserIds.map((r) => r.id);

        // Snapshot the TG users whose active-team row is about to be deleted.
        // After the deletes we'll promote a remaining linked team to active
        // for each, so a DM author isn't left in a "linked but no active
        // team" state when they had other teams linked.
        const deactivationCandidates = await tx
          .select({ telegramUserId: telegramUserTeams.telegramUserId })
          .from(telegramUserTeams)
          .where(
            and(
              eq(telegramUserTeams.teamId, active.teamId),
              eq(telegramUserTeams.isActive, true),
              or(
                ownedIds.length > 0
                  ? inArray(telegramUserTeams.telegramUserId, ownedIds)
                  : sql`false`,
                eq(telegramUserTeams.linkedByUserId, memberUserId),
              ),
            ),
          );
        const affectedTgIds = Array.from(
          new Set(deactivationCandidates.map((r) => r.telegramUserId)),
        );

        if (ownedIds.length > 0) {
          await tx
            .delete(telegramUserTeams)
            .where(
              and(
                eq(telegramUserTeams.teamId, active.teamId),
                inArray(telegramUserTeams.telegramUserId, ownedIds),
              ),
            );
        }
        await tx
          .delete(telegramUserTeams)
          .where(
            and(
              eq(telegramUserTeams.teamId, active.teamId),
              eq(telegramUserTeams.linkedByUserId, memberUserId),
            ),
          );
        await tx
          .delete(telegramChatBindings)
          .where(
            and(
              eq(telegramChatBindings.teamId, active.teamId),
              eq(telegramChatBindings.boundByUserId, memberUserId),
            ),
          );

        // For each TG user that just lost its active routing row, promote
        // the oldest remaining linked team to active. Skip if another active
        // row somehow survived (paranoia) or if they have no remaining
        // links at all.
        await Promise.all(
          affectedTgIds.map(async (tgUserId) => {
            const remaining = await tx
              .select({ id: telegramUserTeams.id, isActive: telegramUserTeams.isActive })
              .from(telegramUserTeams)
              .where(eq(telegramUserTeams.telegramUserId, tgUserId))
              .orderBy(asc(telegramUserTeams.createdAt), asc(telegramUserTeams.id));
            const oldest = remaining[0];
            if (!oldest) return;
            if (remaining.some((r) => r.isActive)) return;
            await tx
              .update(telegramUserTeams)
              .set({ isActive: true })
              .where(eq(telegramUserTeams.id, oldest.id));
          }),
        );

        const affectedSlackRows = await tx
          .select({ slackUserId: slackUserTeams.slackUserId })
          .from(slackUserTeams)
          .where(
            and(
              eq(slackUserTeams.teamId, active.teamId),
              eq(slackUserTeams.isActive, true),
              or(
                eq(slackUserTeams.userId, memberUserId),
                eq(slackUserTeams.linkedByUserId, memberUserId),
              ),
            ),
          );
        const affectedSlackIds = Array.from(new Set(affectedSlackRows.map((r) => r.slackUserId)));

        await tx
          .delete(slackUserTeams)
          .where(
            and(
              eq(slackUserTeams.teamId, active.teamId),
              or(
                eq(slackUserTeams.userId, memberUserId),
                eq(slackUserTeams.linkedByUserId, memberUserId),
              ),
            ),
          );
        await tx
          .update(slackConversationBindings)
          .set({ enabled: false, updatedAt: new Date() })
          .where(
            and(
              eq(slackConversationBindings.teamId, active.teamId),
              eq(slackConversationBindings.boundByUserId, memberUserId),
            ),
          );

        await Promise.all(
          affectedSlackIds.map(async (slackUserId) => {
            const remaining = await tx
              .select({ id: slackUserTeams.id, isActive: slackUserTeams.isActive })
              .from(slackUserTeams)
              .where(eq(slackUserTeams.slackUserId, slackUserId))
              .orderBy(asc(slackUserTeams.createdAt), asc(slackUserTeams.id));
            const oldest = remaining[0];
            if (!oldest) return;
            if (remaining.some((r) => r.isActive)) return;
            await tx
              .update(slackUserTeams)
              .set({ isActive: true })
              .where(eq(slackUserTeams.id, oldest.id));
          }),
        );
        if (platform)
          await recordPlatformAudit(tx as unknown as Db, {
            actorUserId: platform.actor.userId,
            teamId: active.teamId,
            targetId: memberUserId,
            action: 'membership.change',
            reason: platform.reason,
            metadata: { role: formData.get('role') ?? 'removed' },
          });
        await tx.insert(auditLog).values({
          teamId: active.teamId,
          actorUserId: session.user.id,
          action: 'settings.change',
          targetType: 'team',
          targetId: active.teamId,
          targetVisibility: 'team',
          metadata: { setting: 'team.member_removed', memberUserId, role: targetRole },
        });
        return { ok: true };
      });
      if (outcome.error) return outcome;
    } catch (e) {
      if (e instanceof PolarIdentityError) return { error: e.message };
      if (e instanceof Error && e.message === 'last_owner') {
        reportCaughtError(e, { surface: 'server_action', operation: 'remove_member' });
        return { error: 'The team needs at least one owner' };
      }
      throw e;
    }
    await Promise.all(
      ownerLeftAttention.map(async (item) => {
        try {
          await integrationsLib.adminRecordConnectionAttention(db, active.teamId, {
            providerConnectionId: item.providerConnectionId,
            integrationId: item.integrationId,
            category: 'needs_new_owner',
            summary: 'Connection owner left team — choose a replacement connection',
          });
        } catch (err) {
          reportCaughtError(err, {
            surface: 'server_action',
            operation: 'remove_member_connection_attention',
          });
        }
      }),
    );
    trackProductEventBestEffort(
      { kind: 'user', userId: session.user.id, teamId: active.teamId },
      'team_management_action_completed',
      { action: 'member_remove' },
    );
    revalidatePath('/app/team');
    return { ok: true };
  });
}
