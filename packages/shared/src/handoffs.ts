import { handoffSnapshots, type Db } from '@timeline/db';
import { and, eq } from 'drizzle-orm';

export function createHandoffScope(
  db: Db,
  teamId: string,
  userId: string,
  ensureMember: () => Promise<unknown>,
) {
  return {
    async read(id: string) {
      await ensureMember();
      const [row] = await db
        .select()
        .from(handoffSnapshots)
        .where(and(eq(handoffSnapshots.teamId, teamId), eq(handoffSnapshots.id, id)));
      return row ?? null;
    },
    async create(projectId: string, turnId: string, body: unknown) {
      await ensureMember();
      const [created] = await db
        .insert(handoffSnapshots)
        .values({
          teamId,
          projectId,
          turnId,
          authorId: userId,
          body,
        })
        .onConflictDoNothing()
        .returning({ id: handoffSnapshots.id });
      if (created) return created.id;
      const [existing] = await db
        .select({ id: handoffSnapshots.id })
        .from(handoffSnapshots)
        .where(
          and(
            eq(handoffSnapshots.teamId, teamId),
            eq(handoffSnapshots.turnId, turnId),
            eq(handoffSnapshots.authorId, userId),
          ),
        );
      return existing?.id ?? null;
    },
  };
}
