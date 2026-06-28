import { users } from '@timeline/db';
import { cacheKey, cachedJson } from '@timeline/shared/cache';
import { getAudioBucket, getS3PresignClient, getSignedGetObjectUrl } from '@timeline/shared/s3';
import { withTeam } from '@timeline/shared/team-scope';
import { localDateSpanToUtcRange } from '@timeline/shared/time';
import { inArray } from 'drizzle-orm';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';
import { listTimelineCapturedFilesByEventId } from '@/lib/timeline-captured-files';
import {
  parseTimelineImpacts,
  parseTimelineSources,
  timelineSourceValues,
} from '@/lib/timeline-controls';
import {
  buildTimelineMoments,
  timelineMomentLookupPlan,
  toTimelineMomentDto,
} from '@/lib/timeline-moments';
import { trackTimelineMomentsViewed } from '@/lib/timeline-observability';
import {
  applyCachedTimelineMomentPresentations,
  collectTimelinePage,
  emptyTimelineMomentPresentationCacheStats,
  focusedRelatedEventWindow,
  serializeTimelineEvent,
  type TimelineMomentPresentationCacheStats,
} from '@/lib/timeline-page';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseTimelineMode(input: string | null): 'moments' | 'events' {
  return input === 'events' ? 'events' : 'moments';
}

function parseMomentId(input: string | null): string | null {
  if (!input || input.length > 500) return null;
  return input.startsWith('moment:') ? input : null;
}

function nextDateInput(input: string): string {
  const d = new Date(`${input}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function parseStartOfDay(input: string | null, timezone: string): Date | undefined {
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return undefined;
  try {
    return localDateSpanToUtcRange(input, nextDateInput(input), timezone).from;
  } catch {
    return undefined;
  }
}

function parseEndOfDay(input: string | null, timezone: string): Date | undefined {
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return undefined;
  try {
    return localDateSpanToUtcRange(input, nextDateInput(input), timezone).to;
  } catch {
    return undefined;
  }
}

function parseUuids(input: string | null): string[] {
  if (!input) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(',')) {
    const part = raw.trim();
    if (UUID_RE.test(part) && !seen.has(part)) {
      seen.add(part);
      out.push(part);
    }
  }
  return out;
}

async function signAudio(events: { id: string; contentAudioUrl: string | null }[]) {
  const audioEvents = events.filter((e) => e.contentAudioUrl);
  const audioUrls: Record<string, string> = {};
  if (audioEvents.length === 0) return audioUrls;
  try {
    const s3 = getS3PresignClient();
    const bucket = getAudioBucket();
    const pairs = await Promise.all(
      audioEvents.map(async (event) => {
        try {
          return [
            event.id,
            await getSignedGetObjectUrl(s3, bucket, event.contentAudioUrl ?? '', 3600),
          ] as const;
        } catch {
          return [event.id, ''] as const;
        }
      }),
    );
    for (const [id, url] of pairs) if (url) audioUrls[id] = url;
  } catch {
    return audioUrls;
  }
  return audioUrls;
}

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return Response.json({ error: 'no_active_team' }, { status: 400 });

  const url = new URL(req.url);
  const authorUserIds = parseUuids(url.searchParams.get('author'));
  const authorUserId = authorUserIds.length > 0 ? authorUserIds : undefined;
  const cursor = url.searchParams.get('cursor');
  const source = parseTimelineSources(url.searchParams.get('source') ?? undefined);
  const sourceValue = source.join(',');
  const sourceValues = timelineSourceValues(source);
  const impact = parseTimelineImpacts(url.searchParams.get('impact') ?? undefined);
  const impactValue = impact.join(',');
  const event = url.searchParams.get('event');
  const focusEventId = event && UUID_RE.test(event) ? event : null;
  const focusMomentId = parseMomentId(url.searchParams.get('moment'));
  const mode = parseTimelineMode(url.searchParams.get('mode'));
  const includeMomentDiagnostics =
    url.searchParams.get('debug') === 'moment_diagnostics' ||
    url.searchParams.get('diagnostics') === 'moments';

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();
  const settings = await scope.calendar.getCalendarSettings();
  const timezone = settings.defaultTimezone;
  const from = parseStartOfDay(url.searchParams.get('from'), timezone);
  const to = parseEndOfDay(url.searchParams.get('to'), timezone);

  const key = cacheKey([
    'timeline-page',
    active.teamId,
    session.user.id,
    authorUserIds.join(','),
    from?.toISOString(),
    to?.toISOString(),
    sourceValue,
    impactValue,
    focusEventId,
    focusMomentId,
    mode,
    timezone,
    cursor,
    includeMomentDiagnostics,
  ]);
  const page = await cachedJson(key, 30, async () => {
    const result = await collectTimelinePage({
      cursor,
      impact,
      focusEventId: cursor ? null : focusEventId,
      focusMomentId: cursor ? null : focusMomentId,
      mode,
      timezone,
      fetchPage: async ({ cursor: pageCursor, limit }) => {
        const eventsPage = await scope.timeline.listEventsPage({
          authorUserId,
          from,
          to,
          source: sourceValues,
          cursor: pageCursor ?? undefined,
          limit,
        });
        return {
          items: eventsPage.items.map(serializeTimelineEvent),
          nextCursor: eventsPage.nextCursor,
        };
      },
      fetchEventsByIds: async (eventIds) =>
        (await scope.timeline.getEventsByIds(eventIds)).map(serializeTimelineEvent),
      fetchRelatedEventsForFocus: async (focusedEvent) => {
        const window = focusedRelatedEventWindow(focusedEvent);
        const events = await scope.timeline.listEvents({
          from: window.from,
          to: window.to,
          source: focusedEvent.source,
          limit: 100,
        });
        return events.map(serializeTimelineEvent);
      },
      fetchEventsForMoment: async (momentId) => {
        const plan = timelineMomentLookupPlan(momentId);
        if (!plan) return [];
        const events = await scope.timeline.listEventsForMomentLookup(plan);
        return events.map(serializeTimelineEvent);
      },
      hydrateImpact: (eventIds) => scope.timeline.listImpactItems(eventIds),
    });
    const authorIds = Array.from(
      new Set(result.items.map((e) => e.authorUserId).filter((v): v is string => v !== null)),
    );
    const authorRows =
      authorIds.length > 0
        ? await db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(inArray(users.id, authorIds))
        : [];
    const eventIds = result.items.map((eventItem) => eventItem.id);
    const [artifactClusters, capturedFiles] = await Promise.all([
      scope.timeline.listArtifactClusters(eventIds),
      listTimelineCapturedFilesByEventId({
        db,
        teamId: active.teamId,
        userId: session.user.id,
        eventIds,
      }),
    ]);
    const authorMap = new Map(authorRows.map((row) => [row.id, row] as const));
    let presentationCacheStats: TimelineMomentPresentationCacheStats =
      emptyTimelineMomentPresentationCacheStats();
    const moments =
      mode === 'moments'
        ? (
            await applyCachedTimelineMomentPresentations(
              buildTimelineMoments(result.items, authorMap, {
                impactItemsByEventId: result.impactItems,
                artifactClustersByEventId: artifactClusters,
                timezone,
              }),
              {
                teamId: active.teamId,
                listMomentPresentations: (cacheKeys) =>
                  scope.timeline.listMomentPresentations(cacheKeys),
                enqueueMissingPresentation: async ({ cacheKey, rawEventIds }) => {
                  const q = await requireRedisQueue();
                  await q.enqueueTimelineMomentPresentationJob({
                    teamId: active.teamId,
                    userId: session.user.id,
                    cacheKey,
                    rawEventIds,
                  });
                },
                onCacheStats: (stats) => {
                  presentationCacheStats = stats;
                },
              },
            )
          ).map(toTimelineMomentDto)
        : [];
    return {
      version: 'timeline_moments_page.v1' as const,
      groupingVersion: 'timeline_grouping.v1' as const,
      mode,
      moments,
      rawEventsById:
        mode === 'moments'
          ? Object.fromEntries(result.items.map((eventItem) => [eventItem.id, eventItem]))
          : {},
      ...(includeMomentDiagnostics ? { diagnostics: result.diagnostics } : {}),
      __timelineObservability: {
        diagnostics: result.diagnostics,
        presentationCacheStats,
      },
      items: result.items,
      nextCursor: result.nextCursor,
      authors: Object.fromEntries(authorRows.map((row) => [row.id, row])),
      impactItems: result.impactItems,
      artifactClusters,
      capturedFiles,
    };
  });
  const { __timelineObservability, ...responsePage } = page;
  trackTimelineMomentsViewed({
    teamId: active.teamId,
    userId: session.user.id,
    surface: 'api',
    diagnostics: __timelineObservability.diagnostics,
    presentationCacheStats: __timelineObservability.presentationCacheStats,
    filters: {
      author: authorUserIds.length > 0 ? authorUserIds.join(',') : null,
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      source: sourceValue || null,
      impact: impactValue || null,
      event: focusEventId,
      moment: focusMomentId,
      cursor,
    },
  });

  return Response.json({
    ...responsePage,
    audioUrls: await signAudio(responsePage.items),
  });
}
