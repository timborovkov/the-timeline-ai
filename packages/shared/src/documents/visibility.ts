import { documents } from '@timeline/db';
import { and, eq, or, sql } from 'drizzle-orm';

export function documentVisibleToUser(userId: string) {
  return or(
    eq(documents.visibility, 'team'),
    and(eq(documents.visibility, 'private'), eq(documents.ownerUserId, userId)),
    and(
      eq(documents.visibility, 'specific_users'),
      sql`${userId}::uuid = ANY(${documents.visibilityUserIds})`,
    ),
  );
}
