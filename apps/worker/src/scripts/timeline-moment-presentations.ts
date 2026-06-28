/**
 * Timeline moment presentation backfill.
 *
 * Finds eligible timeline moments whose AI presentation cache is missing and
 * enqueues the same worker jobs normal timeline reads enqueue. Dry-run is the
 * default; pass `--enqueue` to spend queue/LLM capacity.
 *
 * Usage:
 *   pnpm --filter @timeline/worker timeline-moment-presentations -- \
 *     --team=<uuid> [--user=<uuid>] [--since=2026-06-01] [--until=2026-06-04]
 *     [--source=all|telegram|slack|integration|email|meeting|calendar|document|ingest_webhook|system]
 *     [--max-events=500] [--limit=100] [--enqueue]
 *
 * By default the script uses the zero UUID service actor, which can only see
 * team-visible events. Use `--user=<uuid>` only when intentionally prewarming a
 * real user's private/specific-user visible timeline.
 */
import { pathToFileURL } from 'node:url';

import { closeDb, getDb, users } from '@timeline/db';
import { queue } from '@timeline/shared';
import { encodeCursor } from '@timeline/shared/pagination';
import { withTeam } from '@timeline/shared/team-scope';
import {
  buildTimelineMoments,
  type TimelineMoment,
  type TimelineMomentEvent,
} from '@timeline/shared/timeline-moments';
import {
  buildTimelineMomentPresentationCacheFingerprint,
  buildTimelineMomentPresentationCacheKey,
  timelineMomentPresentationEligibility,
  type TimelineMomentPresentationCacheKey,
  type TimelineMomentPresentationCacheRecord,
} from '@timeline/shared/timeline-moments/presentation';
import { inArray } from 'drizzle-orm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const DEFAULT_SINCE_DAYS = 14;
const DEFAULT_MAX_EVENTS = 500;
const DEFAULT_LIMIT = 100;
const PAGE_SIZE = 200;

const SOURCE_VALUES = [
  'all',
  'telegram',
  'slack',
  'integration',
  'email',
  'meeting',
  'calendar',
  'document',
  'ingest_webhook',
  'system',
] as const;

type SourceArg = (typeof SOURCE_VALUES)[number];

export interface Args {
  teamId: string;
  userId: string;
  since: Date | null;
  until: Date | null;
  source: SourceArg;
  maxEvents: number;
  limit: number;
  enqueue: boolean;
}

export interface PresentationBackfillCandidate {
  momentId: string;
  cacheKey: TimelineMomentPresentationCacheKey;
  cacheFingerprint: string;
  rawEventIds: string[];
}

export interface PresentationBackfillPlan {
  candidates: PresentationBackfillCandidate[];
  stats: {
    moments: number;
    cached: number;
    ineligible: number;
    limited: number;
  };
}

function parseDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[0-9]+$/.test(value)) throw new Error(`Invalid ${flag}. Use a positive integer.`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${flag}. Use a positive integer.`);
  }
  return parsed;
}

export function parseArgs(argv = process.argv.slice(2), now = new Date()): Args {
  let teamId = '';
  let userId = ZERO_UUID;
  let since: Date | null = new Date(now.getTime() - DEFAULT_SINCE_DAYS * 24 * 60 * 60 * 1000);
  let until: Date | null = null;
  let source: SourceArg = 'all';
  let maxEvents = DEFAULT_MAX_EVENTS;
  let limit = DEFAULT_LIMIT;
  let enqueue = false;

  for (const arg of argv) {
    if (arg.startsWith('--team=')) teamId = arg.slice('--team='.length);
    else if (arg.startsWith('--user=')) userId = arg.slice('--user='.length);
    else if (arg.startsWith('--since=')) {
      since = parseDate(arg.slice('--since='.length));
      if (!since) throw new Error('Invalid --since date');
    } else if (arg.startsWith('--until=')) {
      until = parseDate(arg.slice('--until='.length));
      if (!until) throw new Error('Invalid --until date');
    } else if (arg.startsWith('--source=')) {
      const parsed = arg.slice('--source='.length) as SourceArg;
      if (!SOURCE_VALUES.includes(parsed)) {
        throw new Error(`Invalid --source. Use one of: ${SOURCE_VALUES.join(', ')}.`);
      }
      source = parsed;
    } else if (arg.startsWith('--max-events=')) {
      maxEvents = parsePositiveInteger(arg.slice('--max-events='.length), '--max-events');
    } else if (arg.startsWith('--limit=')) {
      limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
    } else if (arg === '--all') {
      since = null;
    } else if (arg === '--enqueue') {
      enqueue = true;
    } else if (arg === '--dry-run') {
      enqueue = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!UUID_RE.test(teamId)) throw new Error('--team=<uuid> is required');
  if (!UUID_RE.test(userId)) throw new Error('--user must be a UUID when provided');
  return { teamId, userId, since, until, source, maxEvents, limit, enqueue };
}

export function planTimelineMomentPresentationBackfill(input: {
  teamId: string;
  moments: TimelineMoment[];
  cachedPresentations: Record<string, TimelineMomentPresentationCacheRecord>;
  limit: number;
}): PresentationBackfillPlan {
  const candidates: PresentationBackfillCandidate[] = [];
  let cached = 0;
  let ineligible = 0;
  let limited = 0;

  for (const moment of input.moments) {
    const cacheKey = buildTimelineMomentPresentationCacheKey({ teamId: input.teamId, moment });
    const cacheFingerprint = buildTimelineMomentPresentationCacheFingerprint(cacheKey);
    if (input.cachedPresentations[cacheFingerprint]) {
      cached += 1;
      continue;
    }
    if (!timelineMomentPresentationEligibility(moment).eligible) {
      ineligible += 1;
      continue;
    }
    if (candidates.length >= input.limit) {
      limited += 1;
      continue;
    }
    candidates.push({
      momentId: moment.id,
      cacheKey,
      cacheFingerprint,
      rawEventIds: moment.rawEvents.map((event) => event.id),
    });
  }

  return {
    candidates,
    stats: { moments: input.moments.length, cached, ineligible, limited },
  };
}

async function loadVisibleEvents(args: Args) {
  const db = getDb();
  const scope = withTeam(db, args.teamId, args.userId, { skipMembershipCheck: true });
  const events: TimelineMomentEvent[] = [];
  let cursor: string | null = null;

  while (events.length < args.maxEvents) {
    const requestLimit = Math.min(PAGE_SIZE, args.maxEvents - events.length);
    const page = await scope.timeline.listEvents({
      ...(args.since ? { from: args.since } : {}),
      ...(args.until ? { to: args.until } : {}),
      ...(args.source !== 'all' ? { source: args.source } : {}),
      cursor,
      limit: requestLimit,
    });
    if (page.length === 0) break;
    events.push(...(page as TimelineMomentEvent[]));
    const last = page.at(-1);
    if (!last || page.length < requestLimit) break;
    cursor = encodeCursor({ at: last.occurredAt.toISOString(), id: last.id });
  }

  return { db, scope, events };
}

async function main(): Promise<void> {
  const args = parseArgs();
  try {
    const { db, scope, events } = await loadVisibleEvents(args);
    const authorIds = events.map((event) => event.authorUserId).filter(isString);
    const authorRows =
      authorIds.length > 0
        ? await db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(inArray(users.id, authorIds))
        : [];
    const eventIds = events.map((event) => event.id);
    const [impactItemsByEventId, artifactClustersByEventId] = await Promise.all([
      scope.timeline.listImpactItems(eventIds),
      scope.timeline.listArtifactClusters(eventIds),
    ]);
    const moments = buildTimelineMoments(events, new Map(authorRows.map((row) => [row.id, row])), {
      impactItemsByEventId,
      artifactClustersByEventId,
    });
    const cacheKeys = moments.map((moment) =>
      buildTimelineMomentPresentationCacheKey({ teamId: args.teamId, moment }),
    );
    const cachedPresentations = await scope.timeline.listMomentPresentations(cacheKeys);
    const plan = planTimelineMomentPresentationBackfill({
      teamId: args.teamId,
      moments,
      cachedPresentations,
      limit: args.limit,
    });

    console.log(
      [
        `scanned ${String(events.length)} visible event(s)`,
        `built ${String(plan.stats.moments)} moment(s)`,
        `${String(plan.candidates.length)} missing eligible presentation(s)`,
        `${String(plan.stats.cached)} cached`,
        `${String(plan.stats.ineligible)} ineligible`,
        `${String(plan.stats.limited)} over limit`,
        args.enqueue ? 'enqueue mode' : 'dry-run',
      ].join(' · '),
    );

    for (const candidate of plan.candidates) {
      console.log(
        `${args.enqueue ? 'enqueue' : 'would enqueue'} ${candidate.momentId} (${candidate.rawEventIds.length} source event${candidate.rawEventIds.length === 1 ? '' : 's'})`,
      );
      if (!args.enqueue) continue;
      await queue.enqueueTimelineMomentPresentationJob({
        teamId: args.teamId,
        userId: args.userId,
        rawEventIds: candidate.rawEventIds,
        cacheKey: candidate.cacheKey,
      });
    }
  } finally {
    await queue.closeTimelineMomentPresentationQueue().catch(() => undefined);
    await queue.closeRedisConnection().catch(() => undefined);
    await closeDb().catch(() => undefined);
  }
}

function isString(value: string | null): value is string {
  return typeof value === 'string';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
