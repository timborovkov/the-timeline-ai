import { type Db, timelineMomentPresentations } from '@timeline/db';
import { and, eq, inArray } from 'drizzle-orm';

import {
  buildTimelineMomentPresentationCacheFingerprint,
  timelineMomentPresentationCacheKeyMatches,
  timelineMomentPresentationSuggestionSchema,
  type TimelineMomentPresentationCacheKey,
  type TimelineMomentPresentationCacheRecord,
  type TimelineMomentPresentationSuggestion,
} from '#src/timeline-moments/presentation.js';

export interface UpsertTimelineMomentPresentationInput {
  cacheKey: TimelineMomentPresentationCacheKey;
  suggestion: TimelineMomentPresentationSuggestion;
  generatedAt?: Date | undefined;
}

interface TimelineMomentPresentationCacheDeps {
  db: Db;
  teamId: string;
  ensureMember: () => Promise<unknown>;
}

export function createTimelineMomentPresentationCache({
  db,
  teamId,
  ensureMember,
}: TimelineMomentPresentationCacheDeps) {
  function timelineMomentPresentationCacheKeyFromRow(
    row: typeof timelineMomentPresentations.$inferSelect,
  ): TimelineMomentPresentationCacheKey {
    return {
      teamId: row.teamId,
      momentKey: row.momentKey,
      visibilityScopeHash: row.visibilityScopeHash,
      visibleSourceEventIdsHash: row.visibleSourceEventIdsHash,
      visibleSourceContentHash: row.visibleSourceContentHash,
      impactHydrationHash: row.impactHydrationHash,
      artifactClusterHash: row.artifactClusterHash,
      promptVersion: row.promptVersion,
      model: row.model,
    };
  }

  async function listTimelineMomentPresentations(
    cacheKeys: TimelineMomentPresentationCacheKey[],
  ): Promise<Record<string, TimelineMomentPresentationCacheRecord>> {
    await ensureMember();
    if (cacheKeys.length === 0) return {};
    const expectedByFingerprint = new Map(
      cacheKeys.map((cacheKey) => [
        buildTimelineMomentPresentationCacheFingerprint(cacheKey),
        cacheKey,
      ]),
    );
    const rows = await db
      .select()
      .from(timelineMomentPresentations)
      .where(
        and(
          eq(timelineMomentPresentations.teamId, teamId),
          inArray(timelineMomentPresentations.cacheFingerprint, [...expectedByFingerprint.keys()]),
        ),
      );
    const result: Record<string, TimelineMomentPresentationCacheRecord> = {};
    for (const row of rows) {
      const expected = expectedByFingerprint.get(row.cacheFingerprint);
      if (!expected) continue;
      const cacheKey = timelineMomentPresentationCacheKeyFromRow(row);
      if (!timelineMomentPresentationCacheKeyMatches(expected, cacheKey)) continue;
      const parsed = timelineMomentPresentationSuggestionSchema.safeParse(row.suggestion);
      if (!parsed.success) continue;
      result[row.cacheFingerprint] = {
        cacheKey,
        cacheFingerprint: row.cacheFingerprint,
        suggestion: parsed.data,
        generatedAt: row.generatedAt,
      };
    }
    return result;
  }

  async function upsertTimelineMomentPresentation(
    input: UpsertTimelineMomentPresentationInput,
  ): Promise<TimelineMomentPresentationCacheRecord> {
    await ensureMember();
    if (input.cacheKey.teamId !== teamId) {
      throw new Error('Timeline moment presentation cache key belongs to another team');
    }
    const suggestion = timelineMomentPresentationSuggestionSchema.parse(input.suggestion);
    const cacheFingerprint = buildTimelineMomentPresentationCacheFingerprint(input.cacheKey);
    const generatedAt = input.generatedAt ?? new Date();
    const rows = await db
      .insert(timelineMomentPresentations)
      .values({
        teamId,
        momentKey: input.cacheKey.momentKey,
        cacheFingerprint,
        visibilityScopeHash: input.cacheKey.visibilityScopeHash,
        visibleSourceEventIdsHash: input.cacheKey.visibleSourceEventIdsHash,
        visibleSourceContentHash: input.cacheKey.visibleSourceContentHash,
        impactHydrationHash: input.cacheKey.impactHydrationHash,
        artifactClusterHash: input.cacheKey.artifactClusterHash,
        promptVersion: input.cacheKey.promptVersion,
        model: input.cacheKey.model,
        suggestion,
        generatedAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [timelineMomentPresentations.teamId, timelineMomentPresentations.cacheFingerprint],
        set: {
          momentKey: input.cacheKey.momentKey,
          visibilityScopeHash: input.cacheKey.visibilityScopeHash,
          visibleSourceEventIdsHash: input.cacheKey.visibleSourceEventIdsHash,
          visibleSourceContentHash: input.cacheKey.visibleSourceContentHash,
          impactHydrationHash: input.cacheKey.impactHydrationHash,
          artifactClusterHash: input.cacheKey.artifactClusterHash,
          promptVersion: input.cacheKey.promptVersion,
          model: input.cacheKey.model,
          suggestion,
          generatedAt,
          updatedAt: new Date(),
        },
      })
      .returning();
    const row = rows[0];
    if (!row) {
      throw new Error('Failed to persist timeline moment presentation');
    }
    return {
      cacheKey: timelineMomentPresentationCacheKeyFromRow(row),
      cacheFingerprint: row.cacheFingerprint,
      suggestion,
      generatedAt: row.generatedAt,
    };
  }

  return {
    listMomentPresentations: listTimelineMomentPresentations,
    upsertMomentPresentation: upsertTimelineMomentPresentation,
  };
}
