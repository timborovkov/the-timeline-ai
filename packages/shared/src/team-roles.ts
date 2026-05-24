import { teamMembers } from '@timeline/db';
import { and, eq } from 'drizzle-orm';

/**
 * Transaction-scoped utility: lock the team's owner rows and verify that
 * removing or demoting `userId` would leave at least one owner remaining.
 * Throws `Error('last_owner')` when the action would strand the team.
 *
 * Uses `SELECT FOR UPDATE` so two concurrent ownership mutations on the
 * same team serialize through the row lock — without it, two simultaneous
 * demotions could both pass the count check and leave zero owners.
 *
 * `tx` is a Drizzle transaction or db instance (anything with `.select()`).
 */
// `tx` is structurally any Drizzle PgDatabase/PgTransaction. Typing it as
// `unknown` and casting locally avoids a hard dependency on the postgres-js
// generic parameters, which differ between callers.
export async function assertNotLastOwner(
  tx: unknown,
  teamId: string,
  userId: string,
): Promise<void> {
  const t = tx as {
    select: (cols: { userId: typeof teamMembers.userId }) => {
      from: (table: typeof teamMembers) => {
        where: (cond: ReturnType<typeof and>) => {
          for: (mode: 'update') => Promise<{ userId: string }[]>;
        };
      };
    };
  };
  const ownerRows = await t
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, 'owner')))
    .for('update');
  const otherOwners = ownerRows.filter((r) => r.userId !== userId);
  if (otherOwners.length === 0) {
    throw new Error('last_owner');
  }
}
