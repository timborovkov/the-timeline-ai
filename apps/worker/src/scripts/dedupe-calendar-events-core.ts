const TITLE_STOPWORDS = new Set([
  'and',
  'busy',
  'calendar',
  'call',
  'event',
  'meeting',
  'meetings',
  'palaveri',
  'regarding',
  'scheduled',
  'tapaaminen',
  'team',
  'teams',
  'the',
  'with',
]);

export interface EventRow {
  id: string;
  title: string;
  description: string | null;
  location?: string | null;
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
  redacted: boolean;
  updatedAt?: Date;
}

export interface DuplicateGroup {
  key: string;
  survivor: EventRow;
  duplicates: EventRow[];
  skippedRecurringMasters: EventRow[];
}

export interface DuplicateGroupOptions {
  additionalDuplicateClusters?: string[][];
}

export function duplicateTextTokens(
  event: Pick<EventRow, 'title' | 'description' | 'location'>,
): string[] {
  return [event.title, event.description, event.location]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !TITLE_STOPWORDS.has(token))
    .sort();
}

export function duplicateKey(event: EventRow): string {
  return [
    duplicateTextTokens({ title: event.title, description: null, location: null }).join('+') ||
      event.title.toLowerCase().trim(),
    event.startAt.toISOString(),
    event.endAt.toISOString(),
    String(event.allDay),
    event.visibility,
  ].join('|');
}

function slotKey(event: EventRow): string {
  return [
    event.startAt.toISOString(),
    event.endAt.toISOString(),
    String(event.allDay),
    event.visibility,
  ].join('|');
}

function tokenSet(event: EventRow): Set<string> {
  return new Set(duplicateTextTokens(event));
}

function sharedTokens(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((token) => b.has(token));
}

function areLikelyDuplicates(
  left: EventRow,
  right: EventRow,
  leftTokens = tokenSet(left),
  rightTokens = tokenSet(right),
): boolean {
  if (duplicateKey(left) === duplicateKey(right)) return true;
  if (slotKey(left) !== slotKey(right)) return false;

  const shared = sharedTokens(leftTokens, rightTokens);
  if (shared.length >= 2) return true;

  const leftSparse = leftTokens.size <= 2;
  const rightSparse = rightTokens.size <= 2;
  return shared.some((token) => token.length >= 5) && (leftSparse || rightSparse);
}

export function chooseSurvivor(events: EventRow[]): EventRow {
  const evidenceTime = (event: EventRow) => (event.updatedAt ?? event.createdAt).getTime();
  const [survivor] = [...events].sort((a, b) => {
    if (evidenceTime(a) !== evidenceTime(b)) return evidenceTime(b) - evidenceTime(a);
    if (a.agentSuggested !== b.agentSuggested) return a.agentSuggested ? 1 : -1;
    const sourceRank = (source: string) => (source === 'internal' ? 0 : 1);
    if (sourceRank(a.source) !== sourceRank(b.source)) {
      return sourceRank(a.source) - sourceRank(b.source);
    }
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  if (!survivor) throw new Error('Cannot choose a survivor from an empty duplicate group');
  return survivor;
}

function isRecurringMaster(event: EventRow): boolean {
  return event.recurringParentId === null && event.rrule !== null && event.rrule.length > 0;
}

function duplicateClusterKey(events: EventRow[]): string {
  const representative = chooseSurvivor(events);
  const tokens = [...new Set(events.flatMap((event) => duplicateTextTokens(event)))].sort();
  return [
    tokens.slice(0, 12).join('+') || representative.title.toLowerCase().trim(),
    slotKey(representative),
  ].join('|');
}

function duplicateSlotGroups(events: EventRow[]): EventRow[][] {
  const groups: EventRow[][] = [];
  const tokens = new Map(events.map((event) => [event.id, tokenSet(event)]));
  const seen = new Set<string>();

  for (const event of events) {
    if (seen.has(event.id)) continue;

    const group: EventRow[] = [];
    const queue = [event];
    seen.add(event.id);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      group.push(current);
      const currentTokens = tokens.get(current.id) ?? tokenSet(current);

      for (const candidate of events) {
        if (seen.has(candidate.id)) continue;
        const candidateTokens = tokens.get(candidate.id) ?? tokenSet(candidate);
        if (!areLikelyDuplicates(current, candidate, currentTokens, candidateTokens)) continue;
        seen.add(candidate.id);
        queue.push(candidate);
      }
    }

    if (group.length > 1) groups.push(group);
  }

  return groups;
}

function groupFromIds(eventsById: Map<string, EventRow>, ids: string[]): EventRow[] | null {
  const uniqueEvents = [...new Set(ids)]
    .map((id) => eventsById.get(id))
    .filter((event): event is EventRow => event !== undefined && !event.redacted);
  if (uniqueEvents.length < 2) return null;
  const [first] = uniqueEvents;
  if (!first) return null;
  if (uniqueEvents.some((event) => event.visibility !== first.visibility)) return null;
  return uniqueEvents;
}

function mergeOverlappingGroups(groups: EventRow[][]): EventRow[][] {
  const merged: EventRow[][] = [];
  const seenGroups = new Set<number>();
  const eventsById = new Map(groups.flat().map((event) => [event.id, event]));

  for (const [index, group] of groups.entries()) {
    if (seenGroups.has(index)) continue;

    const eventIds = new Set(group.map((event) => event.id));
    seenGroups.add(index);

    let changed = true;
    while (changed) {
      changed = false;
      for (const [candidateIndex, candidate] of groups.entries()) {
        if (seenGroups.has(candidateIndex)) continue;
        if (!candidate.some((event) => eventIds.has(event.id))) continue;
        for (const event of candidate) eventIds.add(event.id);
        seenGroups.add(candidateIndex);
        changed = true;
      }
    }

    merged.push(
      [...eventIds]
        .map((id) => eventsById.get(id))
        .filter((event): event is EventRow => Boolean(event)),
    );
  }

  return merged;
}

export function duplicateGroups(
  events: EventRow[],
  options: DuplicateGroupOptions = {},
): DuplicateGroup[] {
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const bySlot = new Map<string, EventRow[]>();
  for (const event of events) {
    if (event.redacted) continue;
    const key = slotKey(event);
    bySlot.set(key, [...(bySlot.get(key) ?? []), event]);
  }

  const deterministicGroups = [...bySlot.values()].flatMap(duplicateSlotGroups);
  const additionalGroups = (options.additionalDuplicateClusters ?? [])
    .map((ids) => groupFromIds(eventsById, ids))
    .filter((group): group is EventRow[] => Boolean(group));

  return mergeOverlappingGroups([...deterministicGroups, ...additionalGroups]).map((group) => {
    const survivor = chooseSurvivor(group);
    const duplicateCandidates = group.filter((event) => event.id !== survivor.id);
    return {
      key: duplicateClusterKey(group),
      survivor,
      duplicates: duplicateCandidates.filter((event) => !isRecurringMaster(event)),
      skippedRecurringMasters: duplicateCandidates.filter(isRecurringMaster),
    };
  });
}
