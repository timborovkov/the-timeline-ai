import {
  dailyDigests,
  updateRuns,
  messageDeliveries,
  messagePreferences,
  teamBillingAccounts,
  teamCalendarSettings,
  teamMembers,
  updateSchedules,
  users,
  type Db,
} from '@timeline/db';
import { FULL_MEMBER_ROLES } from '@timeline/db/contracts/workspace-access';
import { DEFAULT_WORKSPACE_TIMEZONE } from '@timeline/db/contracts/workspace-time';
import { and, desc, eq, exists, inArray, isNotNull, isNull, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  DEFAULT_UPDATE_KEY,
  DEFAULT_UPDATE_SETTINGS,
  HOME_UPDATE_KEY,
  HOME_UPDATE_SETTINGS,
  updateSettingsSchema,
  type DeliveredUpdateChannel,
  type UpdateSchedule,
  type UpdateSettings,
} from '#src/messaging/update-settings.js';
import { activeWorkspaceCondition } from '#src/platform-admin/runtime.js';
import { assertValidTimezone } from '#src/time/index.js';

const workspaceSchedule = alias(updateSchedules, 'workspace_update_default');
const memberDefault = alias(updateSchedules, 'member_update_default');
const DEFAULT_TIMEZONE = DEFAULT_WORKSPACE_TIMEZONE;
const PERSONAL_DELIVERY_SUFFIXES = ['', ':slack_dm_members', ':telegram_dm_members'];

function parseSettings(value: unknown): UpdateSettings | undefined {
  const parsed = updateSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function profileRevision(epoch: string, timezone: string, updatedAt?: Date | null): string {
  return [epoch, timezone, updatedAt?.toISOString() ?? 'initial'].join('/');
}

function legacyDefault(hour?: number | null) {
  return {
    ...DEFAULT_UPDATE_SETTINGS,
    time:
      typeof hour === 'number' && hour >= 0 && hour <= 23
        ? `${String(hour).padStart(2, '0')}:00`
        : DEFAULT_UPDATE_SETTINGS.time,
  };
}

function inheritedDefault(identity: {
  workspaceSettings: unknown;
  legacyHour: number | null;
  legacyEnabled: boolean | null;
}) {
  const settings = parseSettings(identity.workspaceSettings) ?? legacyDefault(identity.legacyHour);
  return {
    ...settings,
    includeContent: false,
    enabled: settings.enabled && identity.legacyEnabled !== false,
  };
}

export function createUpdateScope({
  db,
  teamId,
  userId,
  ensureMember,
}: {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (role?: 'admin') => Promise<unknown>;
}) {
  const own = and(eq(updateSchedules.teamId, teamId), eq(updateSchedules.userId, userId));
  const digestOwner = and(eq(updateRuns.teamId, teamId), eq(updateRuns.userId, userId));

  async function identity() {
    await ensureMember();
    const [row] = await db
      .select({
        epoch: teamMembers.authorizationEpoch,
        timezone: teamCalendarSettings.defaultTimezone,
        legacyOptions: messagePreferences.updateOptions,
        legacyHour: messagePreferences.dailyDigestHour,
        legacyEnabled: messagePreferences.dailyDigestEnabled,
        workspaceSettings: workspaceSchedule.settings,
        workspaceUpdatedAt: workspaceSchedule.updatedAt,
      })
      .from(teamMembers)
      .leftJoin(teamCalendarSettings, eq(teamCalendarSettings.teamId, teamMembers.teamId))
      .leftJoin(
        messagePreferences,
        and(
          eq(messagePreferences.teamId, teamMembers.teamId),
          eq(messagePreferences.userId, teamMembers.userId),
        ),
      )
      .leftJoin(
        workspaceSchedule,
        and(eq(workspaceSchedule.teamId, teamMembers.teamId), isNull(workspaceSchedule.userId)),
      )
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, userId),
          isNull(teamMembers.removedAt),
          inArray(teamMembers.role, FULL_MEMBER_ROLES),
        ),
      )
      .limit(1);
    if (!row) throw new Error('Update membership is no longer active');
    return { ...row, timezone: assertValidTimezone(row.timezone ?? DEFAULT_TIMEZONE) };
  }

  async function list() {
    const principal = await identity();
    const rows = await db
      .select()
      .from(updateSchedules)
      .where(own)
      .orderBy(
        sql`${updateSchedules.scheduleKey} <> ${DEFAULT_UPDATE_KEY}`,
        updateSchedules.scheduleKey,
      );
    const schedules: UpdateSchedule[] = rows.flatMap((row) => {
      const settings = parseSettings(row.settings);
      return settings
        ? [
            {
              key: row.scheduleKey,
              settings,
              revision: profileRevision(principal.epoch, principal.timezone, row.updatedAt),
              inherited: false,
            },
          ]
        : [];
    });
    if (
      !principal.legacyOptions &&
      !schedules.some((schedule) => schedule.key === DEFAULT_UPDATE_KEY)
    ) {
      schedules.unshift({
        key: DEFAULT_UPDATE_KEY,
        settings: inheritedDefault(principal),
        revision: profileRevision(
          principal.epoch,
          principal.timezone,
          principal.workspaceUpdatedAt,
        ),
        inherited: true,
      });
    }
    return {
      timezone: principal.timezone,
      hasLegacySchedule: Boolean(principal.legacyOptions),
      schedules,
      workspaceDefault: parseSettings(principal.workspaceSettings) ?? DEFAULT_UPDATE_SETTINGS,
    };
  }

  return {
    list,
    async current(key: string) {
      if (key === HOME_UPDATE_KEY) {
        const principal = await identity();
        return {
          timezone: principal.timezone,
          schedule: {
            key,
            settings: HOME_UPDATE_SETTINGS,
            revision: profileRevision(principal.epoch, principal.timezone),
            inherited: true,
          },
        };
      }
      const { timezone, schedules } = await list();
      return { timezone, schedule: schedules.find((schedule) => schedule.key === key) };
    },
    async save(key: string, input: UpdateSettings, forWorkspace = false) {
      await ensureMember(forWorkspace ? 'admin' : undefined);
      const settings = updateSettingsSchema.parse(
        forWorkspace ? { ...input, includeContent: false } : input,
      );
      validateScheduleKey(key);
      if (forWorkspace && key !== DEFAULT_UPDATE_KEY)
        throw new Error('Choose the workspace default');
      if (key !== DEFAULT_UPDATE_KEY && settings.sections.includes('savedViews')) {
        throw new Error('Saved views are delivered with your default update');
      }
      const updatedAt = new Date();
      if (forWorkspace) {
        await db
          .insert(updateSchedules)
          .values({ teamId, scheduleKey: key, settings, updatedAt })
          .onConflictDoUpdate({
            target: updateSchedules.teamId,
            targetWhere: isNull(updateSchedules.userId),
            set: { settings, updatedAt },
            setWhere: sql`${updateSchedules.settings} IS DISTINCT FROM excluded.settings`,
          });
      } else {
        await db
          .insert(updateSchedules)
          .values({ teamId, userId, scheduleKey: key, settings, updatedAt })
          .onConflictDoUpdate({
            target: [updateSchedules.teamId, updateSchedules.userId, updateSchedules.scheduleKey],
            targetWhere: isNotNull(updateSchedules.userId),
            set: { settings, updatedAt },
            setWhere: sql`${updateSchedules.settings} IS DISTINCT FROM excluded.settings`,
          });
      }
    },
    async remove(key: string, reset = false) {
      await ensureMember();
      validateScheduleKey(key);
      if ((key === DEFAULT_UPDATE_KEY) !== reset) throw new Error('Choose a personal schedule');
      await db.delete(updateSchedules).where(and(own, eq(updateSchedules.scheduleKey, key)));
    },
    async latestHome() {
      await ensureMember();
      const [row] = await db
        .select()
        .from(updateRuns)
        .where(
          and(
            digestOwner,
            eq(updateRuns.scheduleKey, HOME_UPDATE_KEY),
            eq(updateRuns.status, 'generated'),
          ),
        )
        .orderBy(desc(updateRuns.windowEnd))
        .limit(1);
      return row ?? null;
    },
    async findRun(key: string, end: Date) {
      await ensureMember();
      const [row] = await db
        .select()
        .from(updateRuns)
        .where(and(digestOwner, eq(updateRuns.scheduleKey, key), eq(updateRuns.windowEnd, end)))
        .limit(1);
      return row;
    },
    async hasSentLegacyRun(end: Date) {
      await ensureMember();
      const [row] = await db
        .select({ id: dailyDigests.id })
        .from(dailyDigests)
        .where(
          and(
            eq(dailyDigests.teamId, teamId),
            eq(dailyDigests.userId, userId),
            eq(dailyDigests.windowEnd, end),
            eq(dailyDigests.status, 'sent'),
          ),
        )
        .limit(1);
      return Boolean(row);
    },
    async findDeliveryRun(id: string) {
      await ensureMember();
      const [run] = await db
        .select()
        .from(updateRuns)
        .where(and(digestOwner, eq(updateRuns.id, id)))
        .limit(1);
      return run;
    },
    async recordDelivery(
      id: string,
      result: Pick<typeof updateRuns.$inferInsert, 'status' | 'sentAt' | 'error' | 'deliveryId'>,
    ) {
      await ensureMember();
      await db
        .update(updateRuns)
        .set(result)
        .where(and(digestOwner, eq(updateRuns.id, id), sql`${updateRuns.status} <> 'sent'`));
    },
    async storeRun(
      values: Pick<
        typeof updateRuns.$inferInsert,
        'scheduleKey' | 'windowStart' | 'windowEnd' | 'summary' | 'payload' | 'status'
      >,
    ) {
      await ensureMember();
      const [row] = await db
        .insert(updateRuns)
        .values({ ...values, teamId, userId })
        .onConflictDoNothing()
        .returning({ id: updateRuns.id });
      return row?.id;
    },
    async history(selectedId?: string) {
      await ensureMember();
      const hasDelivery = exists(
        db
          .select({ id: messageDeliveries.id })
          .from(messageDeliveries)
          .where(
            and(
              eq(messageDeliveries.teamId, teamId),
              eq(messageDeliveries.userId, userId),
              eq(messageDeliveries.status, 'sent'),
              inArray(
                sql<string>`${messageDeliveries.dedupeKey}`,
                PERSONAL_DELIVERY_SUFFIXES.map(
                  (suffix) => sql`'daily_digest:' || ${updateRuns.id}::text || ${suffix}`,
                ),
              ),
            ),
          ),
      );
      const [rows, selected] = await Promise.all([
        db
          .select()
          .from(updateRuns)
          .where(
            and(
              digestOwner,
              sql`${updateRuns.scheduleKey} <> ${HOME_UPDATE_KEY}`,
              or(eq(updateRuns.status, 'sent'), hasDelivery),
            ),
          )
          .orderBy(desc(updateRuns.windowEnd), desc(updateRuns.generatedAt))
          .limit(90),
        selectedId && isUuid(selectedId)
          ? db
              .select()
              .from(updateRuns)
              .where(
                and(
                  digestOwner,
                  eq(updateRuns.id, selectedId),
                  or(inArray(updateRuns.status, ['sent', 'generated']), hasDelivery),
                ),
              )
              .limit(1)
          : [],
      ]);
      const requested = selected[0];
      return requested && requested.scheduleKey !== HOME_UPDATE_KEY
        ? [requested, ...rows.filter((row) => row.id !== requested.id)]
        : rows;
    },
    async deliveryInfo(ids: string[]) {
      await ensureMember();
      const deliveries = new Map<
        string,
        { channels: DeliveredUpdateChannel[]; sentAt: Date | null }
      >();
      if (!ids.length) return deliveries;
      const keys = ids.flatMap((id) =>
        PERSONAL_DELIVERY_SUFFIXES.map((suffix) => `daily_digest:${id}${suffix}`),
      );
      const rows = await db
        .select({
          channel: messageDeliveries.channel,
          key: messageDeliveries.dedupeKey,
          sentAt: messageDeliveries.sentAt,
        })
        .from(messageDeliveries)
        .where(
          and(
            eq(messageDeliveries.teamId, teamId),
            eq(messageDeliveries.userId, userId),
            eq(messageDeliveries.status, 'sent'),
            inArray(messageDeliveries.dedupeKey, keys),
          ),
        );
      for (const { channel, key, sentAt } of rows) {
        const id = key?.split(':')[1];
        if (!id || channel === 'in_app_digest') continue;
        const delivery = deliveries.get(id) ?? { channels: [], sentAt: null };
        delivery.channels.push(channel);
        if (sentAt && (!delivery.sentAt || sentAt > delivery.sentAt)) delivery.sentAt = sentAt;
        deliveries.set(id, delivery);
      }
      return deliveries;
    },
  };
}

function isUuid(value: string) {
  return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
}

function validateScheduleKey(key: string) {
  if (key !== DEFAULT_UPDATE_KEY && !isUuid(key)) throw new Error('Choose a valid update schedule');
}

/** Cross-workspace enumeration only admits active principals and reads scheduling metadata. */
export async function listUpdateDispatchCandidates(db: Db) {
  const rows = await db
    .select({
      teamId: teamMembers.teamId,
      userId: teamMembers.userId,
      epoch: teamMembers.authorizationEpoch,
      joinedAt: teamMembers.createdAt,
      timezone: teamCalendarSettings.defaultTimezone,
      legacyOptions: messagePreferences.updateOptions,
      legacyHour: messagePreferences.dailyDigestHour,
      legacyEnabled: messagePreferences.dailyDigestEnabled,
      workspaceSettings: workspaceSchedule.settings,
      workspaceUpdatedAt: workspaceSchedule.updatedAt,
      hasMemberDefault: memberDefault.scheduleKey,
      memberKey: updateSchedules.scheduleKey,
      memberSettings: updateSchedules.settings,
      memberUpdatedAt: updateSchedules.updatedAt,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .leftJoin(teamCalendarSettings, eq(teamCalendarSettings.teamId, teamMembers.teamId))
    .leftJoin(
      messagePreferences,
      and(
        eq(messagePreferences.teamId, teamMembers.teamId),
        eq(messagePreferences.userId, teamMembers.userId),
      ),
    )
    .leftJoin(
      workspaceSchedule,
      and(eq(workspaceSchedule.teamId, teamMembers.teamId), isNull(workspaceSchedule.userId)),
    )
    .leftJoin(
      memberDefault,
      and(
        eq(memberDefault.teamId, teamMembers.teamId),
        eq(memberDefault.userId, teamMembers.userId),
        eq(memberDefault.scheduleKey, DEFAULT_UPDATE_KEY),
      ),
    )
    .leftJoin(
      updateSchedules,
      and(
        eq(updateSchedules.teamId, teamMembers.teamId),
        eq(updateSchedules.userId, teamMembers.userId),
      ),
    )
    .where(
      and(
        activeWorkspaceCondition(teamMembers.teamId),
        isNull(teamMembers.removedAt),
        inArray(teamMembers.role, FULL_MEMBER_ROLES),
        isNull(users.suspendedAt),
        notExists(
          db
            .select({ id: teamBillingAccounts.teamId })
            .from(teamBillingAccounts)
            .where(
              and(
                eq(teamBillingAccounts.teamId, teamMembers.teamId),
                inArray(teamBillingAccounts.securityState, ['suspended', 'terminated']),
              ),
            ),
        ),
      ),
    );

  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const timezone = assertValidTimezone(row.timezone ?? DEFAULT_TIMEZONE);
    const { teamId, userId, joinedAt, epoch } = row;
    const base = { teamId, userId, timezone, joinedAt };
    const identity = `${teamId}/${userId}`;
    const result: (typeof base & {
      key: string;
      settings: UpdateSettings;
      changedAt: Date | null;
      revision: string;
    })[] = [];
    const draft = parseSettings(row.memberSettings);
    if (row.memberKey && draft?.enabled)
      result.push({
        ...base,
        key: row.memberKey,
        settings: draft,
        changedAt: row.memberUpdatedAt,
        revision: profileRevision(epoch, timezone, row.memberUpdatedAt),
      });
    if (!seen.has(identity)) {
      seen.add(identity);
      result.push({
        ...base,
        key: HOME_UPDATE_KEY,
        settings: HOME_UPDATE_SETTINGS,
        changedAt: null,
        revision: profileRevision(epoch, timezone),
      });
      const settings = inheritedDefault(row);
      if (!row.hasMemberDefault && !row.legacyOptions && settings.enabled)
        result.push({
          ...base,
          key: DEFAULT_UPDATE_KEY,
          settings,
          changedAt: row.workspaceUpdatedAt,
          revision: profileRevision(epoch, timezone, row.workspaceUpdatedAt),
        });
    }
    return result;
  });
}
