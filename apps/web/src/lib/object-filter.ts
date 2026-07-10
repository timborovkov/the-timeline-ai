import type * as objects from '@timeline/shared/objects/types';

type GroupKey = 'status' | 'stage' | 'priority' | 'type';

interface ObjectFilterOptions {
  groupBy?: GroupKey;
  typeLabels?: Record<string, string>;
}

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
  const formatted = date.toISOString().slice(0, 10);
  return raw === formatted ? [formatted] : [raw, formatted];
}

function displayedGroupValue(row: objects.ObjectRow, groupBy: GroupKey | undefined): string | null {
  if (!groupBy) return null;
  const value = row[groupBy];
  return value === null ? 'unset' : String(value);
}

function searchableObjectText(row: objects.ObjectRow, options: ObjectFilterOptions = {}): string {
  const typeLabel = options.typeLabels?.[row.type] ?? null;
  const groupValue = displayedGroupValue(row, options.groupBy);
  const values = [
    row.canonicalName,
    row.type,
    typeLabel,
    row.status,
    row.stage,
    row.priority,
    groupValue,
    row.ownerUserId,
    row.assigneeUserId,
    ...dateSearchValues(row.dueAt),
    ...row.aliases,
  ].filter((value): value is string | number => value !== null);
  const metadataValues: string[] = [];
  addMetadataValues(metadataValues, row.metadata);
  return [...values.map(String), ...metadataValues].join(' ').toLocaleLowerCase();
}

export function objectMatchesTextFilter(
  row: objects.ObjectRow,
  query: string,
  options?: ObjectFilterOptions,
): boolean {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const text = searchableObjectText(row, options);
  return tokens.every((token) => text.includes(token));
}

export function filterObjectsByText<T extends objects.ObjectRow>(
  rows: T[],
  query: string,
  options?: ObjectFilterOptions,
): T[] {
  if (!normalize(query)) return rows;
  return rows.filter((row) => objectMatchesTextFilter(row, query, options));
}
