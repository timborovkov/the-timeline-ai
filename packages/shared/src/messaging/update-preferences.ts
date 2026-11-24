import { messagePreferences, type Db } from '@timeline/db';
import { sql } from 'drizzle-orm';

type UpdateOptions = NonNullable<typeof messagePreferences.$inferSelect.updateOptions>;

export function createUpdatePreferencesScope(
  db: Db,
  teamId: string,
  userId: string,
  requireMembership: () => Promise<string>,
) {
  return {
    async save(input: {
      enabled: boolean;
      hour: number;
      timezone: string;
      options?: UpdateOptions;
    }) {
      const role = await requireMembership();
      if (!['owner', 'admin', 'member'].includes(role))
        throw new Error('Updates require full membership');
      const updatedAt = new Date();
      const changeEnabled = sql`${messagePreferences.dailyDigestEnabled} IS DISTINCT FROM ${input.enabled}`;
      await db
        .insert(messagePreferences)
        .values({
          teamId,
          userId,
          dailyDigestEnabled: input.enabled,
          dailyDigestHour: input.hour,
          timezone: input.timezone,
          updateOptions: input.options ?? null,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: [messagePreferences.teamId, messagePreferences.userId],
          targetWhere: sql`${messagePreferences.teamId} IS NOT NULL AND ${messagePreferences.userId} IS NOT NULL`,
          set: {
            dailyDigestEnabled: input.enabled,
            ...(input.options ? { updateOptions: input.options } : {}),
            updatedAt,
          },
          setWhere: input.options
            ? sql`${changeEnabled} OR ${messagePreferences.updateOptions} IS DISTINCT FROM ${JSON.stringify(input.options)}::jsonb`
            : changeEnabled,
        });
    },
  };
}
