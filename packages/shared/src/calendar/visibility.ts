import { calendarEvents } from '@timeline/db';
import { sql } from 'drizzle-orm';

/** Full details are required for mutations and pins; ordinary reads may return busy blocks. */
export function calendarEventDetailsVisibleToUser(userId: string) {
  return sql`(
    ${calendarEvents.visibility} = 'team'
    OR ${calendarEvents.createdByUserId} = ${userId}::uuid
    OR (${calendarEvents.visibility} = 'specific_users' AND ${userId}::uuid = ANY(${calendarEvents.visibilityUserIds}))
  )`;
}
