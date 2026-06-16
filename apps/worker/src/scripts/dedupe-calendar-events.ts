/**
 * Calendar event duplicate detector. Defaults to dry-run and never deletes
 * rows directly. In --apply mode it queues cancellation approvals for likely
 * duplicate events so a human can review the cleanup.
 *
 * Usage:
 *   pnpm --filter @timeline/worker dedupe-calendar-events -- --team=<teamId> [--limit=N] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--apply]
 */
import { closeDb, getDb } from '@timeline/db';
import { suggestions, withTeam } from '@timeline/shared';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PSEUDO_USER = '00000000-0000-0000-0000-000000000000';
const TITLE_STOPWORDS = new Set([
  'and',
  'calendar',
  'call',
  'event',
  'meeting',
  'palaveri',
  'scheduled',
  'tapaaminen',
  'team',
  'teams',
  'the',
  'with',
]);
const PAGE_SIZE = 500;
const DEFAULT_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

interface Args {
  teamId: string;
  limit: number;
  dryRun: boolean;
  from: Date;
  to?: Date;
}

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  timezone: string;
  allDay: boolean;
  visibility: 'private' | 'team' | 'specific_users';
  recurringParentId: string | null;
  rrule: string | null;
  createdAt: Date;
  source: string;
  agentSuggested: boolean;
}

interface DuplicateGroup {
  key: string;
  survivor: EventRow;
  duplicates: EventRow[];
  skippedRecurringMasters: EventRow[];
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let teamId: string | undefined;
  let limit = 1000;
  let dryRun = true;
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

function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !TITLE_STOPWORDS.has(token))
    .sort();
}

function duplicateKey(event: EventRow): string {
  return [
    titleTokens(event.title).join('+') || event.title.toLowerCase().trim(),
    event.startAt.toISOString(),
    event.endAt.toISOString(),
    String(event.allDay),
    event.visibility,
  ].join('|');
}

function chooseSurvivor(events: EventRow[]): EventRow {
  const [survivor] = [...events].sort((a, b) => {
    if (a.agentSuggested !== b.agentSuggested) return a.agentSuggested ? 1 : -1;
    if (a.source !== b.source) return a.source === 'internal' ? -1 : 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  if (!survivor) throw new Error('Cannot choose a survivor from an empty duplicate group');
  return survivor;
}

function isRecurringMaster(event: EventRow): boolean {
  return event.recurringParentId === null && event.rrule !== null && event.rrule.length > 0;
}

function duplicateGroups(events: EventRow[]): DuplicateGroup[] {
  const byKey = new Map<string, EventRow[]>();
  for (const event of events) {
    const key = duplicateKey(event);
    byKey.set(key, [...(byKey.get(key) ?? []), event]);
  }
  return [...byKey.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => {
      const survivor = chooseSurvivor(group);
      const duplicateCandidates = group.filter((event) => event.id !== survivor.id);
      return {
        key,
        survivor,
        duplicates: duplicateCandidates.filter((event) => !isRecurringMaster(event)),
        skippedRecurringMasters: duplicateCandidates.filter(isRecurringMaster),
      };
    });
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
        summary: `Likely duplicate of "${group.survivor.title}" at ${group.survivor.startAt.toISOString()}.`,
        reason:
          'Calendar duplicate cleanup found matching title tokens, time range, all-day flag, and visibility.',
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
  const { teamId, limit, dryRun, from, to } = parseArgs();
  console.log(
    `[dedupe-calendar-events] team=${teamId} limit=${limit} from=${from.toISOString()}${
      to ? ` to=${to.toISOString()}` : ''
    } mode=${dryRun ? 'dry-run' : 'apply'}`,
  );

  const db = getDb();
  const scope = withTeam(db, teamId, PSEUDO_USER, { skipMembershipCheck: true });
  const events = await listEventsForScan({ scope, limit, from, ...(to ? { to } : {}) });
  const groups = duplicateGroups(events);
  const duplicateCount = groups.reduce((sum, group) => sum + group.duplicates.length, 0);
  const skippedRecurringMasterCount = groups.reduce(
    (sum, group) => sum + group.skippedRecurringMasters.length,
    0,
  );

  console.log(
    `[dedupe-calendar-events] scanned=${events.length} groups=${groups.length} duplicates=${duplicateCount} skippedRecurringMasters=${skippedRecurringMasterCount}${
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

main().catch((err: unknown) => {
  console.error('[dedupe-calendar-events] failed', err);
  process.exit(1);
});
