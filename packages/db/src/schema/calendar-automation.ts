import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { calendarEvents } from '#src/schema/calendar-events.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const googleCalendarImports = pgTable(
  'google_calendar_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ciphertext: bytea('ciphertext').notNull(),
    iv: bytea('iv').notNull(),
    tag: bytea('tag').notNull(),
    calendarId: text('calendar_id'),
    calendarName: text('calendar_name'),
    timezone: text('timezone'),
    syncToken: text('sync_token'),
    lastFullSyncAt: timestamp('last_full_sync_at', { withTimezone: true }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    nextSyncAt: timestamp('next_sync_at', { withTimezone: true }).notNull().defaultNow(),
    syncStatus: text('sync_status'),
    revision: integer('revision').notNull().default(0),
  },
  (table) => [
    uniqueIndex('google_calendar_imports_team_user_unq').on(table.teamId, table.userId),
    index('google_calendar_imports_due_idx')
      .on(table.nextSyncAt)
      .where(sql`${table.calendarId} IS NOT NULL`),
  ],
);

export const calendarReminderPreferences = pgTable(
  'calendar_reminder_preferences',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => calendarEvents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    leadMinutes: integer('lead_minutes').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.eventId, table.userId] }),
    check('calendar_reminder_preferences_lead_check', sql`${table.leadMinutes} between 1 and 1440`),
  ],
);

export const calendarReminderBlocks = pgTable(
  'calendar_reminder_blocks',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => calendarEvents.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    series: boolean('series').notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.series] })],
);
