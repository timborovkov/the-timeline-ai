import type * as objects from '@timeline/shared/objects';

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function addMetadataValues(values: string[], value: unknown, depth = 0): void {
  if (depth > 2 || value === null || value === undefined) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    values.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) addMetadataValues(values, item, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) addMetadataValues(values, item, depth + 1);
  }
}

function dateSearchValues(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (
    !(value instanceof Date) &&
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    return [];
  }
  const raw = value instanceof Date ? value.toISOString() : String(value).trim();
  if (!raw) return [];
  const date = value instanceof Date ? value : new Date(raw);
  if (Number.isNaN(date.getTime())) return [raw];
  const formatted = date.toLocaleDateString('en-CA');
  return raw === formatted ? [formatted] : [raw, formatted];
}

function searchableObjectText(row: objects.ObjectRow): string {
  const values = [
    row.canonicalName,
    row.type,
    row.status,
    row.stage,
    row.priority,
    row.ownerUserId,
    row.assigneeUserId,
    ...dateSearchValues(row.dueAt),
    ...row.aliases,
  ].filter((value): value is string | number => value !== null);
  const metadataValues: string[] = [];
  addMetadataValues(metadataValues, row.metadata);
  return [...values.map(String), ...metadataValues].join(' ').toLocaleLowerCase();
}

export function objectMatchesTextFilter(row: objects.ObjectRow, query: string): boolean {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const text = searchableObjectText(row);
  return tokens.every((token) => text.includes(token));
}

export function filterObjectsByText<T extends objects.ObjectRow>(rows: T[], query: string): T[] {
  if (!normalize(query)) return rows;
  return rows.filter((row) => objectMatchesTextFilter(row, query));
}
