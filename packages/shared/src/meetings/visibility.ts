import { meetings, savedMeetings } from '@timeline/db';
import { sql } from 'drizzle-orm';

export function meetingVisibleToUser(userId: string) {
  return sql`(
    ${meetings.defaultVisibility} = 'team'
    OR (${meetings.defaultVisibility} = 'private' AND ${meetings.createdByUserId} = ${userId}::uuid)
    OR (${meetings.defaultVisibility} = 'specific_users' AND ${userId}::uuid = ANY(${meetings.visibilityUserIds}))
  )`;
}

export function savedMeetingVisibleToUser(userId: string) {
  return sql`(
    ${savedMeetings.defaultVisibility} = 'team'
    OR (${savedMeetings.defaultVisibility} = 'private' AND ${savedMeetings.createdByUserId} = ${userId}::uuid)
    OR (${savedMeetings.defaultVisibility} = 'specific_users' AND ${userId}::uuid = ANY(${savedMeetings.visibilityUserIds}))
  )`;
}
