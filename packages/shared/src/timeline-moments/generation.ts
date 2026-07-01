import { type Db, users } from '@timeline/db';
import { inArray } from 'drizzle-orm';

import type { TeamScope } from '#src/team-scope.js';

import { buildTimelineMoments, type TimelineMomentEvent } from '#src/timeline-moments/index.js';
import {
  buildTimelineMomentPresentationCacheFingerprint,
  buildTimelineMomentPresentationCacheKey,
  generateTimelineMomentPresentation,
  timelineMomentPresentationCacheKeyMatches,
  type GenerateTimelineMomentPresentationOptions,
  type TimelineMomentPresentationCacheKey,
} from '#src/timeline-moments/presentation.js';

export type TimelineMomentPresentationGenerationResult =
  | { status: 'stored'; cacheFingerprint: string; momentId: string }
  | { status: 'already_cached'; cacheFingerprint: string; momentId: string }
  | { status: 'skipped'; reason: string; momentId?: string | undefined };

export interface GenerateAndStoreTimelineMomentPresentationOptions {
  chatStructured?: GenerateTimelineMomentPresentationOptions['chatStructured'];
}

export async function generateAndStoreTimelineMomentPresentation(
  db: Db,
  scope: TeamScope,
  input: {
    rawEventIds: string[];
    cacheKey: TimelineMomentPresentationCacheKey;
  },
  options: GenerateAndStoreTimelineMomentPresentationOptions = {},
): Promise<TimelineMomentPresentationGenerationResult> {
  if (input.cacheKey.teamId !== scope.teamId) {
    return { status: 'skipped', reason: 'team_mismatch' };
  }
  const events = await scope.timeline.getEventsByIds(input.rawEventIds);
  if (events.length === 0) return { status: 'skipped', reason: 'no_visible_events' };

  const rawEventIds = new Set(events.map((event) => event.id));
  if (input.rawEventIds.some((id) => !rawEventIds.has(id))) {
    return { status: 'skipped', reason: 'some_events_not_visible' };
  }

  const authorIds = events.map((event) => event.authorUserId).filter(isString);
  const authorRows =
    authorIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, authorIds))
      : [];
  const authorMap = new Map(authorRows.map((row) => [row.id, row] as const));
  const eventIds = events.map((event) => event.id);
  const [impactItemsByEventId, artifactClustersByEventId] = await Promise.all([
    scope.timeline.listImpactItems(eventIds),
    scope.timeline.listArtifactClusters(eventIds),
  ]);
  const moments = buildTimelineMoments(events as TimelineMomentEvent[], authorMap, {
    impactItemsByEventId,
    artifactClustersByEventId,
  });
  const moment = moments.find((candidate) => candidate.id === input.cacheKey.momentKey);
  if (!moment) return { status: 'skipped', reason: 'moment_not_rebuilt' };

  const rebuiltCacheKey = buildTimelineMomentPresentationCacheKey({
    teamId: scope.teamId,
    moment,
    model: input.cacheKey.model,
    promptVersion: input.cacheKey.promptVersion,
  });
  if (!timelineMomentPresentationCacheKeyMatches(input.cacheKey, rebuiltCacheKey)) {
    return { status: 'skipped', reason: 'stale_cache_key', momentId: moment.id };
  }
  const cacheFingerprint = buildTimelineMomentPresentationCacheFingerprint(rebuiltCacheKey);
  const existing = await scope.timeline.listMomentPresentations([rebuiltCacheKey]);
  if (existing[cacheFingerprint]) {
    return { status: 'already_cached', cacheFingerprint, momentId: moment.id };
  }

  const generated = await generateTimelineMomentPresentation(moment, {
    teamId: scope.teamId,
    model: input.cacheKey.model,
    promptVersion: input.cacheKey.promptVersion,
    ...(options.chatStructured ? { chatStructured: options.chatStructured } : {}),
  });
  if (generated.status === 'skipped') {
    return { status: 'skipped', reason: generated.reason, momentId: moment.id };
  }
  await scope.timeline.upsertMomentPresentation({
    cacheKey: rebuiltCacheKey,
    suggestion: generated.suggestion,
  });
  return { status: 'stored', cacheFingerprint, momentId: moment.id };
}

function isString(value: string | null): value is string {
  return typeof value === 'string';
}
