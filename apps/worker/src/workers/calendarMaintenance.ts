import {
  calendarEvents,
  calendarReminderBlocks,
  calendarReminderPreferences,
  googleCalendarImports,
  notifications,
  teamMembers,
  users,
  type Db,
} from '@timeline/db';
import { withTeam } from '@timeline/shared';
import { PlatformAccessError } from '@timeline/shared/platform-admin';
import {
  activeWorkspaceCondition,
  isInactiveWorkspaceError,
} from '@timeline/shared/platform-admin/runtime';
import { and, asc, eq, gt, isNotNull, isNull, lte, sql } from 'drizzle-orm';

export async function processCalendarMaintenance(db: Db, now = new Date()) {
  const [due, imports] = await Promise.all([
    db
      .select({
        teamId: calendarReminderPreferences.teamId,
        userId: calendarReminderPreferences.userId,
        eventId: calendarReminderPreferences.eventId,
      })
      .from(calendarReminderPreferences)
      .innerJoin(
        calendarEvents,
        and(
          eq(calendarEvents.teamId, calendarReminderPreferences.teamId),
          eq(calendarEvents.id, calendarReminderPreferences.eventId),
        ),
      )
      .innerJoin(
        teamMembers,
        users,
        and(
          eq(teamMembers.teamId, calendarReminderPreferences.teamId),
          eq(teamMembers.userId, calendarReminderPreferences.userId),
          isNull(teamMembers.removedAt),
        ),
      )
      .innerJoin(
        users,
        and(eq(users.id, calendarReminderPreferences.userId), isNull(users.suspendedAt)),
      )
      .where(
        and(
          activeWorkspaceCondition(calendarEvents.teamId),
          isNull(calendarEvents.deletedAt),
          gt(calendarEvents.startAt, now),
          sql`${calendarEvents.startAt} - ${calendarReminderPreferences.leadMinutes} * interval '1 minute' <= ${now.toISOString()}::timestamptz`,
          sql`(${calendarEvents.visibility} = 'team' OR ${calendarEvents.createdByUserId} = ${calendarReminderPreferences.userId}
          OR (${calendarEvents.visibility} = 'specific_users' AND ${calendarReminderPreferences.userId} = ANY(${calendarEvents.visibilityUserIds})))`,
          sql`NOT EXISTS (SELECT 1 FROM ${calendarReminderBlocks} block
          WHERE block.team_id = ${calendarEvents.teamId}
          AND ((NOT block.series AND block.event_id = ${calendarEvents.id})
            OR (block.series AND block.event_id = coalesce(${calendarEvents.recurringParentId}, ${calendarEvents.id}))))`,
          sql`NOT EXISTS (SELECT 1 FROM ${notifications} reminder
          WHERE reminder.team_id = ${calendarReminderPreferences.teamId}
          AND reminder.user_id = ${calendarReminderPreferences.userId}
          AND reminder.kind = 'calendar_reminder'
          AND reminder.payload->>'event_id' = ${calendarEvents.id}::text
          AND (reminder.payload->>'start_at')::timestamptz = ${calendarEvents.startAt})`,
        ),
      )
      .orderBy(asc(calendarEvents.startAt))
      .limit(500),
    db
      .select({ teamId: googleCalendarImports.teamId, userId: googleCalendarImports.userId })
      .from(googleCalendarImports)
      .innerJoin(
        teamMembers,
        users,
        and(
          eq(teamMembers.teamId, googleCalendarImports.teamId),
          eq(teamMembers.userId, googleCalendarImports.userId),
          isNull(teamMembers.removedAt),
        ),
      )
      .innerJoin(users, and(eq(users.id, googleCalendarImports.userId), isNull(users.suspendedAt)))
      .where(
        and(
          activeWorkspaceCondition(googleCalendarImports.teamId),
          isNotNull(googleCalendarImports.calendarId),
          lte(googleCalendarImports.nextSyncAt, now),
        ),
      )
      .orderBy(asc(googleCalendarImports.nextSyncAt))
      .limit(10),
  ]);

  let reminders = 0;
  for (const row of due) {
    try {
      const scope = withTeam(db, row.teamId, row.userId);
      if (await scope.calendar.reminders.deliver(row.eventId, now)) reminders += 1;
    } catch (error) {
      if (!isInactiveWorkspaceError(error) && !(error instanceof PlatformAccessError)) throw error;
    }
  }
  await Promise.all(
    imports.map(async (row) => {
      try {
        await withTeam(db, row.teamId, row.userId).calendar.google.sync(now);
      } catch (error) {
        if (!isInactiveWorkspaceError(error) && !(error instanceof PlatformAccessError))
          throw error;
      }
    }),
  );
  return { reminders, imports: imports.length };
}
