import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { entities } from '#src/schema/entities.js';
import { eventVisibility } from '#src/schema/raw-events.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

// Phase 11 — Calendar. A calendar event is a first-class table (not an
// entity). Each event produces two raw_events rows: one at creation time
// ("scheduled") and one at the event's start_at ("event") so both the
// scheduling action and the event itself appear on the timeline.
//
// Recurring events: the parent row carries an RFC 5545 rrule. A worker
// materialises individual occurrences as child rows on a 3-month rolling
// window. Each child has recurring_parent_id + original_start_at (stable
// identifier that survives rescheduling) + is_exception (skip on
// re-expansion).
//
// Private events are opaque, not invisible: teammates see a "busy" block
// (time + owner) via application-layer redaction. The DB returns the full
// row; the scope strips content when visibility='private' and the reader
// is not the author.

export const calendarEventSource = pgEnum('calendar_event_source', [
  'internal',
  'google',
  'caldav',
]);

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    description: text('description'),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    allDay: boolean('all_day').notNull().default(false),
    location: text('location'),
    showAs: text('show_as').notNull().default('busy'),
    visibility: eventVisibility('visibility').notNull().default('team'),
    visibilityUserIds: uuid('visibility_user_ids').array(),

    // Recurrence — parent carries the rrule; children carry the parent FK.
    recurringParentId: uuid('recurring_parent_id').references(
      (): AnyPgColumn => calendarEvents.id,
      { onDelete: 'cascade' },
    ),
    originalStartAt: timestamp('original_start_at', { withTimezone: true }),
    isException: boolean('is_exception').notNull().default(false),
    rrule: text('rrule'),

    reminderMinutes: integer('reminder_minutes'),
    source: calendarEventSource('source').notNull().default('internal'),
    externalCalendarId: uuid('external_calendar_id'),
    externalEventId: text('external_event_id'),
    agentSuggested: boolean('agent_suggested').notNull().default(false),
    metadata: jsonb('metadata').notNull().default({}),

    // Back-references to the two raw_events rows produced by this event.
    scheduledRawEventId: uuid('scheduled_raw_event_id'),
    startAtRawEventId: uuid('start_at_raw_event_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('calendar_events_team_start_idx').on(table.teamId, table.startAt),
    index('calendar_events_team_created_idx').on(table.teamId, table.createdAt),
    index('calendar_events_team_parent_idx')
      .on(table.teamId, table.recurringParentId)
      .where(sql`${table.recurringParentId} IS NOT NULL`),
    uniqueIndex('calendar_events_external_unq')
      .on(table.teamId, table.externalCalendarId, table.externalEventId)
      .where(sql`${table.externalEventId} IS NOT NULL`),
  ],
);

export const calendarEventEntities = pgTable(
  'calendar_event_entities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    calendarEventId: uuid('calendar_event_id')
      .notNull()
      .references(() => calendarEvents.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    relationshipType: text('relationship_type').notNull().default('related'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('calendar_event_entities_unq').on(table.calendarEventId, table.entityId),
    index('calendar_event_entities_entity_idx').on(table.entityId),
  ],
);

export const teamCalendarSettings = pgTable('team_calendar_settings', {
  teamId: uuid('team_id')
    .primaryKey()
    .references(() => teams.id, { onDelete: 'cascade' }),
  defaultReminderMinutes: integer('default_reminder_minutes').notNull().default(15),
  defaultVisibility: eventVisibility('default_visibility').notNull().default('team'),
  defaultTimezone: text('default_timezone').notNull().default('Europe/Helsinki'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
