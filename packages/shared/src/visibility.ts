import { rawEvents } from '@timeline/db';
import { and, eq, not, or, sql } from 'drizzle-orm';

type VisibilityValue = 'private' | 'team' | 'specific_users';

export function normalizeVisibilityUserIds(
  visibility: VisibilityValue,
  ids: string[] | null | undefined,
): string[] | null {
  if (visibility !== 'specific_users') return null;
  const clean = [...new Set(ids ?? [])];
  if (clean.length === 0) throw new Error('specific_users visibility requires at least one user');
  return clean;
}

export async function validateVisibilityUserIds(
  visibility: VisibilityValue,
  ids: string[] | null | undefined,
  requireTeamMember?: (userId: string) => Promise<void>,
): Promise<string[] | null> {
  const clean = normalizeVisibilityUserIds(visibility, ids);
  if (clean && requireTeamMember) {
    for (const uid of clean) await requireTeamMember(uid);
  }
  return clean;
}

export function rawEventVisibleToUser(userId: string) {
  return or(
    eq(rawEvents.visibility, 'team'),
    and(
      eq(rawEvents.visibility, 'private'),
      or(eq(rawEvents.authorUserId, userId), eq(rawEvents.visibilityOwnerUserId, userId)),
    ),
    and(
      eq(rawEvents.visibility, 'specific_users'),
      or(
        eq(rawEvents.visibilityOwnerUserId, userId),
        sql`COALESCE(${userId}::uuid = ANY(${rawEvents.visibilityUserIds}), false)`,
      ),
    ),
  );
}

export function rawEventHiddenFromUser(userId: string) {
  const visible = rawEventVisibleToUser(userId);
  if (!visible) return sql`false`;
  return not(visible);
}
