import {
  calendarEvents,
  calendarReminderBlocks,
  calendarReminderPreferences,
  notifications,
  type Db,
} from '@timeline/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { calendarEventMutationLockKey } from '#src/calendar/locking.js';
import type { CalendarScopeDeps } from '#src/calendar/scope.js';
import { calendarEventDetailsVisibleToUser } from '#src/calendar/visibility.js';

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createCalendarReminderScope({
  db,
  teamId,
  userId,
  ensureMember,
}: CalendarScopeDeps) {
  async function loadEvent(tx: Db | Transaction, eventId: string, forUpdate = false) {
    const query = tx
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.id, eventId),
          eq(calendarEvents.teamId, teamId),
          isNull(calendarEvents.deletedAt),
          calendarEventDetailsVisibleToUser(userId),
        ),
      );
    const [event] = await (forUpdate ? query.for('update') : query);
    return event ?? null;
  }

  function getPreference(tx: Db | Transaction, eventId: string) {
    return tx
      .select()
      .from(calendarReminderPreferences)
      .where(
        and(
          eq(calendarReminderPreferences.teamId, teamId),
          eq(calendarReminderPreferences.eventId, eventId),
          eq(calendarReminderPreferences.userId, userId),
        ),
      )
      .then(([row]) => row?.leadMinutes ?? null);
  }

  async function getBlocks(tx: Db | Transaction, eventId: string, parentId: string | null) {
    const rows = await tx
      .select()
      .from(calendarReminderBlocks)
      .where(
        and(
          eq(calendarReminderBlocks.teamId, teamId),
          inArray(calendarReminderBlocks.eventId, parentId ? [eventId, parentId] : [eventId]),
        ),
      );
    return {
      eventBlocked: rows.some((row) => row.eventId === eventId && !row.series),
      seriesBlocked: rows.some((row) => row.eventId === (parentId ?? eventId) && row.series),
    };
  }

  async function withEvent<T>(
    eventId: string,
    run: (tx: Transaction, event: typeof calendarEvents.$inferSelect) => Promise<T>,
  ) {
    await ensureMember();
    return db.transaction(async (tx) => {
      const previous = await loadEvent(tx, eventId);
      if (!previous) return null;
      // Series and occurrence mutations acquire these same advisory locks.
      const root = previous.recurringParentId ?? eventId;
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${calendarEventMutationLockKey(teamId, root)}, 0))`,
      );
      if (root !== eventId) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${calendarEventMutationLockKey(teamId, eventId)}, 0))`,
        );
      }
      const event = await loadEvent(tx, eventId, true);
      if (event?.recurringParentId !== previous.recurringParentId) return null;
      return run(tx, event);
    });
  }

  return {
    async getPreference(eventId: string) {
      await ensureMember();
      const event = await loadEvent(db, eventId);
      if (!event) return null;
      const [leadMinutes, blocks] = await Promise.all([
        getPreference(db, eventId),
        getBlocks(db, eventId, event.recurringParentId),
      ]);
      return {
        leadMinutes,
        ...blocks,
        canBlock: event.createdByUserId === userId,
        hasSeries: Boolean(event.recurringParentId ?? event.rrule),
        started: event.startAt <= new Date(),
      };
    },
    async setPreference(eventId: string, leadMinutes: number | null) {
      if (
        leadMinutes !== null &&
        (!Number.isInteger(leadMinutes) || leadMinutes < 1 || leadMinutes > 1440)
      ) {
        throw new Error('Invalid reminder lead time');
      }
      return withEvent(eventId, async (tx, event) => {
        if (leadMinutes === null) {
          await tx
            .delete(calendarReminderPreferences)
            .where(
              and(
                eq(calendarReminderPreferences.teamId, teamId),
                eq(calendarReminderPreferences.eventId, event.id),
                eq(calendarReminderPreferences.userId, userId),
              ),
            );
        } else {
          if (event.startAt <= new Date()) return false;
          const blocks = await getBlocks(tx, event.id, event.recurringParentId);
          if (blocks.eventBlocked || blocks.seriesBlocked) return false;
          await tx
            .insert(calendarReminderPreferences)
            .values({ teamId, eventId: event.id, userId, leadMinutes })
            .onConflictDoUpdate({
              target: [
                calendarReminderPreferences.teamId,
                calendarReminderPreferences.eventId,
                calendarReminderPreferences.userId,
              ],
              set: { leadMinutes },
            });
        }
        return true;
      });
    },
    async setBlock(eventId: string, blocked: boolean, applyToSeries: boolean) {
      return withEvent(eventId, async (tx, event) => {
        const target =
          applyToSeries && event.recurringParentId
            ? await loadEvent(tx, event.recurringParentId)
            : event;
        if (
          !target ||
          (applyToSeries && !target.rrule) ||
          target.createdByUserId !== userId ||
          event.createdByUserId !== userId
        )
          return false;
        if (blocked) {
          await tx
            .insert(calendarReminderBlocks)
            .values({ teamId, eventId: target.id, series: applyToSeries })
            .onConflictDoNothing();
        } else {
          await tx
            .delete(calendarReminderBlocks)
            .where(
              and(
                eq(calendarReminderBlocks.teamId, teamId),
                eq(calendarReminderBlocks.eventId, target.id),
                eq(calendarReminderBlocks.series, applyToSeries),
              ),
            );
        }
        return true;
      });
    },
    async deliver(eventId: string, now: Date) {
      return withEvent(eventId, async (tx, event) => {
        if (event.startAt <= now) return false;
        const leadMinutes = await getPreference(tx, event.id);
        if (
          leadMinutes === null ||
          event.startAt.getTime() - leadMinutes * 60_000 > now.getTime()
        ) {
          return false;
        }
        const blocks = await getBlocks(tx, event.id, event.recurringParentId);
        if (blocks.eventBlocked || blocks.seriesBlocked) return false;
        // Keep the notification content-free in case the event later becomes restricted.
        const inserted = await tx
          .insert(notifications)
          .values({
            teamId,
            userId,
            kind: 'calendar_reminder',
            summary: 'An event on your calendar starts soon.',
            payload: {
              calendar_reminder: true,
              event_id: event.id,
              start_at: event.startAt.toISOString(),
            },
          })
          .onConflictDoNothing()
          .returning({ id: notifications.id });
        return inserted.length > 0;
      });
    },
  };
}
