import { users } from '@timeline/db';
import {
  cacheKey,
  cachedJson,
  getAudioBucket,
  getS3PresignClient,
  getSignedGetObjectUrl,
  withTeam,
} from '@timeline/shared';
import { inArray } from 'drizzle-orm';

import type { TimelineEvent } from '@/lib/use-paginated-queries';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { parseTimelineImpact, parseTimelineSource } from '@/lib/timeline-controls';
import { collectTimelinePage } from '@/lib/timeline-page';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseDate(input: string | null): Date | undefined {
  if (!input) return undefined;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function serializeTimelineEvent(event: {
  id: string;
  teamId: string;
  authorUserId: string | null;
  source: TimelineEvent['source'];
  contentText: string | null;
  contentAudioUrl: string | null;
  occurredAt: Date;
  createdAt: Date;
  visibility: TimelineEvent['visibility'];
  visibilityUserIds: string[] | null;
  visibilityOwnerUserId: string | null;
  sourceMetadata: unknown;
}): TimelineEvent {
  return {
    ...event,
    occurredAt: event.occurredAt.toISOString(),
    createdAt: event.createdAt.toISOString(),
  };
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
  const impact = parseTimelineImpact(url.searchParams.get('impact') ?? undefined);
  const from = parseDate(url.searchParams.get('from'));
  const toRaw = parseDate(url.searchParams.get('to'));
  const to = toRaw ? new Date(toRaw.getTime() + 24 * 60 * 60 * 1000) : undefined;

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();

  const key = cacheKey([
    'timeline-page',
    active.teamId,
    session.user.id,
    authorUserId,
    from?.toISOString(),
    to?.toISOString(),
    source,
    impact,
    cursor,
  ]);
  const page = await cachedJson(key, 30, async () => {
    const result = await collectTimelinePage({
      cursor,
      impact,
      fetchPage: async ({ cursor: pageCursor, limit }) => {
        const eventsPage = await scope.timeline.listEventsPage({
          authorUserId,
          from,
          to,
          source,
          cursor: pageCursor ?? undefined,
          limit,
        });
        return {
          items: eventsPage.items.map(serializeTimelineEvent),
          nextCursor: eventsPage.nextCursor,
        };
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
    return {
      items: result.items,
      nextCursor: result.nextCursor,
      authors: Object.fromEntries(authorRows.map((row) => [row.id, row])),
      impactItems: result.impactItems,
    };
  });

  return Response.json({
    ...page,
    audioUrls: await signAudio(page.items),
  });
}
