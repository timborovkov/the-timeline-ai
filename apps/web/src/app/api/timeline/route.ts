import { users } from '@timeline/db';
import { cacheKey, cachedJson } from '@timeline/shared/cache';
import { getAudioBucket, getS3PresignClient, getSignedGetObjectUrl } from '@timeline/shared/s3';
import { withTeam } from '@timeline/shared/team-scope';
import { localDateSpanToUtcRange } from '@timeline/shared/time';
import { inArray } from 'drizzle-orm';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { listTimelineCapturedFilesByEventId } from '@/lib/timeline-captured-files';
import {
  parseTimelineImpact,
  parseTimelineSource,
  timelineSourceValues,
} from '@/lib/timeline-controls';
import { collectTimelinePage, serializeTimelineEvent } from '@/lib/timeline-page';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  const author = url.searchParams.get('author');
  const authorUserId = author && UUID_RE.test(author) ? author : undefined;
  const cursor = url.searchParams.get('cursor');
  const source = parseTimelineSource(url.searchParams.get('source') ?? undefined);
  const sourceValues = timelineSourceValues(source);
  const impact = parseTimelineImpact(url.searchParams.get('impact') ?? undefined);
  const event = url.searchParams.get('event');
  const focusEventId = event && UUID_RE.test(event) ? event : null;

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
    authorUserId,
    from?.toISOString(),
    to?.toISOString(),
    source,
    impact,
    focusEventId,
    timezone,
    cursor,
  ]);
  const page = await cachedJson(key, 30, async () => {
    const result = await collectTimelinePage({
      cursor,
      impact,
      focusEventId: cursor ? null : focusEventId,
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
    return {
      items: result.items,
      nextCursor: result.nextCursor,
      authors: Object.fromEntries(authorRows.map((row) => [row.id, row])),
      impactItems: result.impactItems,
      capturedFiles: await listTimelineCapturedFilesByEventId({
        db,
        teamId: active.teamId,
        userId: session.user.id,
        eventIds: result.items.map((eventItem) => eventItem.id),
      }),
    };
  });

  return Response.json({
    ...page,
    audioUrls: await signAudio(page.items),
  });
}
