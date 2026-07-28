/**
 * Calendar event duplicate detector. Defaults to dry-run and never deletes
 * rows directly. In --apply mode it queues cancellation approvals for likely
 * duplicate events so a human can review the cleanup.
 *
 * Usage:
 *   pnpm --filter @timeline/worker dedupe-calendar-events -- --team=<teamId> [--limit=N] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--apply]
 */
import { pathToFileURL } from 'node:url';

import { closeDb, getDb } from '@timeline/db';
import { llm, suggestions, withTeam } from '@timeline/shared';
import { z } from 'zod';

import {
  duplicateGroups,
  duplicateTextTokens,
  type DuplicateGroup,
  type EventRow,
} from '#src/scripts/dedupe-calendar-events-core.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PSEUDO_USER = '00000000-0000-0000-0000-000000000000';
const PAGE_SIZE = 500;
const DEFAULT_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
/** Keep AI batches small enough that duplicate-group JSON fits the default 8k cap. */
export const AI_DUPLICATE_EVENT_BATCH_SIZE = 100;
/**
 * Prefer comparing events that start within this window. Dense calendars are
 * still capped by `AI_DUPLICATE_EVENT_BATCH_SIZE`; sparse calendars expand to
 * chronological neighbors so lone events still get comparison material.
 */
export const AI_DUPLICATE_TIME_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function batchKey(events: EventRow[]): string {
  return events
    .map((event) => event.id)
    .sort()
    .join(',');
}

function chunkEventList(events: EventRow[], batchSize: number): EventRow[][] {
  if (events.length < 2) return [];
  const chunks: EventRow[][] = [];
  for (let offset = 0; offset < events.length; offset += batchSize) {
    const chunk = events.slice(offset, offset + batchSize);
    if (chunk.length >= 2) {
      chunks.push(chunk);
      continue;
    }
    const previous = chunks.at(-1);
    const lone = chunk[0];
    if (!previous || !lone) continue;
    if (previous.length < batchSize) {
      previous.push(lone);
      continue;
    }
    const boundary = previous.at(-1);
    if (boundary) chunks.push([boundary, lone]);
  }
  return chunks;
}

/**
 * Build AI comparison batches from time proximity plus shared title/description
 * tokens. Row-count overlap alone misses rescheduled duplicates when enough
 * unrelated events fall between them; token-linked batches recover those pairs.
 */
export function buildAiDuplicateBatches(
  events: EventRow[],
  batchSize = AI_DUPLICATE_EVENT_BATCH_SIZE,
  timeWindowMs = AI_DUPLICATE_TIME_WINDOW_MS,
): EventRow[][] {
  const sorted = [...events].sort(
    (left, right) => left.startAt.getTime() - right.startAt.getTime(),
  );
  if (sorted.length < 2) return [];
  if (sorted.length <= batchSize) return [sorted];

  const batchesByKey = new Map<string, EventRow[]>();
  const addBatch = (batch: EventRow[]) => {
    if (batch.length < 2) return;
    const key = batchKey(batch);
    if (!batchesByKey.has(key)) batchesByKey.set(key, batch);
  };

  let startIndex = 0;
  while (startIndex < sorted.length - 1) {
    const anchor = sorted[startIndex];
    if (!anchor) break;
    const windowEnd = anchor.startAt.getTime() + timeWindowMs;
    const batch: EventRow[] = [];
    for (let index = startIndex; index < sorted.length && batch.length < batchSize; index += 1) {
      const candidate = sorted[index];
      if (!candidate) break;
      if (candidate.startAt.getTime() > windowEnd && batch.length >= 2) break;
      batch.push(candidate);
    }
    addBatch(batch);
    startIndex += Math.max(1, Math.floor(batch.length / 2));
  }

  const byToken = new Map<string, EventRow[]>();
  for (const event of sorted) {
    for (const token of duplicateTextTokens(event)) {
      if (token.length < 5) continue;
      const linked = byToken.get(token) ?? [];
      linked.push(event);
      byToken.set(token, linked);
    }
  }
  for (const linked of byToken.values()) {
    if (linked.length < 2) continue;
    const unique = [...new Map(linked.map((event) => [event.id, event])).values()].sort(
      (left, right) => left.startAt.getTime() - right.startAt.getTime(),
    );
    for (const chunk of chunkEventList(unique, batchSize)) addBatch(chunk);
  }

  return [...batchesByKey.values()];
}

interface Args {
  teamId: string;
  limit: number;
  dryRun: boolean;
  useAi: boolean;
  from: Date;
  to?: Date;
}

const aiDuplicateGroupSchema = z.object({
  duplicate_groups: z.array(
    z.object({
      event_ids: z.array(z.string()).min(2),
      confidence: z.enum(['low', 'medium', 'high']),
      reason: z.string(),
    }),
  ),
});

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let teamId: string | undefined;
  let limit = 1000;
  let dryRun = true;
  let useAi = true;
  let from: Date | undefined;
  let to: Date | undefined;

  for (const arg of args) {
    if (arg.startsWith('--team=')) teamId = arg.slice('--team='.length);
    else if (arg.startsWith('--limit=')) {
      const parsed = Number.parseInt(arg.slice('--limit='.length), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        console.error('Invalid --limit. Use a positive integer.');
        process.exit(2);
      }
      limit = parsed;
    } else if (arg === '--apply') dryRun = false;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--ai') useAi = true;
    else if (arg === '--no-ai') useAi = false;
    else if (arg.startsWith('--from=')) from = parseDateArg(arg.slice('--from='.length), '--from');
    else if (arg.startsWith('--to=')) to = parseDateArg(arg.slice('--to='.length), '--to');
  }

  if (!teamId || !UUID_RE.test(teamId)) {
    console.error(
      'Usage: dedupe-calendar-events --team=<uuid> [--limit=N] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--apply]',
    );
    process.exit(2);
  }

  return {
    teamId,
    limit,
    dryRun,
    useAi,
    from: from ?? new Date(Date.now() - DEFAULT_LOOKBACK_MS),
    ...(to ? { to } : {}),
  };
}

function parseDateArg(value: string, flag: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    console.error(`Invalid ${flag}. Use an ISO date or timestamp.`);
    process.exit(2);
  }
  return parsed;
}

function compact(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

function formatEventForAi(event: EventRow): Record<string, unknown> {
  return {
    id: event.id,
    title: compact(event.title),
    description: compact(event.description),
    location: compact(event.location),
    startAt: event.startAt.toISOString(),
    endAt: event.endAt.toISOString(),
    timezone: event.timezone,
    allDay: event.allDay,
    visibility: event.visibility,
    source: event.source,
    agentSuggested: event.agentSuggested,
    recurring: event.recurringParentId !== null || Boolean(event.rrule),
  };
}

export async function aiDuplicateClusters(input: {
  events: EventRow[];
  chatStructured?: typeof llm.chatStructured;
  batchSize?: number;
  timeWindowMs?: number;
}): Promise<string[][]> {
  const chatStructured = input.chatStructured ?? llm.chatStructured;
  const batchSize = input.batchSize ?? AI_DUPLICATE_EVENT_BATCH_SIZE;
  const timeWindowMs = input.timeWindowMs ?? AI_DUPLICATE_TIME_WINDOW_MS;
  const candidateEvents = input.events.filter((event) => !event.redacted);
  if (candidateEvents.length < 2) return [];

  const clusters: string[][] = [];
  let failedBatches = 0;
  for (const batch of buildAiDuplicateBatches(candidateEvents, batchSize, timeWindowMs)) {
    try {
      const result = await chatStructured({
        schema: aiDuplicateGroupSchema,
        model: llm.TIMELINE_MODELS.summarization.id,
        system:
          'You identify duplicate calendar events. Group events only when they refer to the same real-world meeting. Titles, times, dates, duration, timezone, and all-day state may differ because calendars can import, translate, normalize, or reschedule the same meeting differently. Use titles, descriptions, locations, meeting links, attendee/client names, language translations, agenda wording, and time proximity as evidence. Do not group different meetings just because they overlap or mention the same company/person. If uncertain, omit the group. Return JSON only.',
        prompt: JSON.stringify({
          events: batch.map(formatEventForAi),
        }),
      });
      for (const group of result.object.duplicate_groups) {
        if (group.confidence === 'low') continue;
        clusters.push(group.event_ids);
      }
    } catch (err) {
      failedBatches += 1;
      console.warn(
        `[dedupe-calendar-events] ai batch failed; retaining ${clusters.length} cluster(s) from earlier batches`,
        err,
      );
    }
  }

  if (failedBatches > 0 && clusters.length === 0) {
    throw new Error(`ai duplicate adjudication failed for all ${String(failedBatches)} batch(es)`);
  }

  return clusters;
}

async function queueCancellationApprovals(input: {
  groups: DuplicateGroup[];
  scope: ReturnType<typeof withTeam>;
}): Promise<number> {
  let queued = 0;
  for (const group of input.groups) {
    for (const duplicate of group.duplicates) {
      const dedupeKey = suggestions.suggestionDedupeKey({
        tool: 'dedupe-calendar-events',
        survivorId: group.survivor.id,
        duplicateId: duplicate.id,
      });
      await input.scope.suggestions.createOrMergeSuggestionBundle({
        source: 'background',
        title: `Cancel duplicate calendar event: ${duplicate.title}`,
        summary: `Likely duplicate of newer-evidence event "${group.survivor.title}" at ${group.survivor.startAt.toISOString()}.`,
        reason:
          'Calendar duplicate cleanup found duplicate meeting evidence across calendar event details.',
        confidence: 'medium',
        dedupeKey,
        visibility: duplicate.visibility,
        items: [
          {
            operation: 'archive_or_cancel',
            targetKind: 'calendar_event',
            targetId: duplicate.id,
            title: `Cancel duplicate ${duplicate.title}`,
            dedupeKey,
            proposedPayload: {
              duplicateOfCalendarEventId: group.survivor.id,
              cleanupKey: group.key,
              recurrenceEditMode: 'single',
            },
          },
        ],
      });
      queued += 1;
    }
  }
  return queued;
}

async function listEventsForScan(input: {
  scope: ReturnType<typeof withTeam>;
  limit: number;
  from: Date;
  to?: Date;
}): Promise<EventRow[]> {
  const events: EventRow[] = [];
  let offset = 0;
  while (events.length < input.limit) {
    const pageLimit = Math.min(PAGE_SIZE, input.limit - events.length);
    const page = await input.scope.calendar.listCalendarEventPage({
      from: input.from,
      ...(input.to ? { to: input.to } : {}),
      includeDeleted: false,
      limit: pageLimit,
      offset,
      order: 'asc',
    });
    events.push(...(page.events as EventRow[]));
    offset += page.events.length;
    if (page.events.length < pageLimit || offset >= page.total) break;
  }
  return events;
}

async function main(): Promise<void> {
  const { teamId, limit, dryRun, useAi, from, to } = parseArgs();
  console.log(
    `[dedupe-calendar-events] team=${teamId} limit=${limit} from=${from.toISOString()}${
      to ? ` to=${to.toISOString()}` : ''
    } mode=${dryRun ? 'dry-run' : 'apply'} ai=${useAi ? 'on' : 'off'}`,
  );

  const db = getDb();
  const scope = withTeam(db, teamId, PSEUDO_USER, { skipMembershipCheck: true });
  const events = await listEventsForScan({ scope, limit, from, ...(to ? { to } : {}) });
  let aiClusters: string[][] = [];
  if (useAi) {
    try {
      aiClusters = await aiDuplicateClusters({ events });
    } catch (err) {
      console.warn(
        '[dedupe-calendar-events] ai duplicate adjudication failed; using deterministic groups only',
        err,
      );
    }
  }
  const groups = duplicateGroups(events, { additionalDuplicateClusters: aiClusters });
  const duplicateCount = groups.reduce((sum, group) => sum + group.duplicates.length, 0);
  const skippedRecurringMasterCount = groups.reduce(
    (sum, group) => sum + group.skippedRecurringMasters.length,
    0,
  );

  console.log(
    `[dedupe-calendar-events] scanned=${events.length} aiClusters=${aiClusters.length} groups=${groups.length} duplicates=${duplicateCount} skippedRecurringMasters=${skippedRecurringMasterCount}${
      dryRun ? ' (dry-run, no approvals queued)' : ''
    }`,
  );
  for (const group of groups.slice(0, 50)) {
    console.log(
      `[dedupe-calendar-events] survivor=${group.survivor.id} "${group.survivor.title}" duplicates=${group.duplicates
        .map((event) => event.id)
        .join(',')}`,
    );
    if (group.skippedRecurringMasters.length > 0) {
      console.log(
        `[dedupe-calendar-events] recurring masters skipped=${group.skippedRecurringMasters
          .map((event) => event.id)
          .join(',')} (manual review required)`,
      );
    }
  }
  if (groups.length > 50) {
    console.log(`[dedupe-calendar-events] ... ${groups.length - 50} more groups`);
  }

  if (!dryRun && groups.length > 0) {
    const queued = await queueCancellationApprovals({ groups, scope });
    console.log(`[dedupe-calendar-events] queued=${queued} cancellation approval item(s)`);
  }

  await closeDb();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error('[dedupe-calendar-events] failed', err);
    process.exit(1);
  });
}
