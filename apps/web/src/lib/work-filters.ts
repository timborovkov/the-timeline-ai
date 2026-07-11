import { OBJECT_TYPES } from '@timeline/shared/objects/types';

import type { BoardItemFilter } from '@timeline/shared/boards';
import type { ObjectListFilter, ObjectType } from '@timeline/shared/objects/types';

import { taskStatusFilterValues } from '@/lib/task-statuses';

export const UNASSIGNED_FILTER_VALUE = 'unassigned';
export const NONE_FILTER_VALUE = 'none';
const DUE_PRESETS = ['overdue', 'today', 'next7', 'none', 'range'] as const;
const PRIORITY_VALUES = ['1', '2', '3', '4', NONE_FILTER_VALUE] as const;
export const WORK_FILTER_PARAM_KEYS = [
  'q',
  'type',
  'status',
  'stage',
  'owner',
  'assignee',
  'responsible',
  'lane',
  'priority',
  'due',
  'dueFrom',
  'dueTo',
  'createdFrom',
  'createdTo',
  'updatedFrom',
  'updatedTo',
] as const;

type DuePreset = (typeof DUE_PRESETS)[number];

export type FilterSearchParams = Record<string, string | string[] | undefined>;

export interface MemberFilterOption {
  id: string;
  label: string;
}

export interface WorkFilterState {
  q: string;
  type: string;
  status: string;
  stage: string;
  owner: string;
  assignee: string;
  responsible: string;
  lane: string;
  priority: string;
  due: DuePreset | '';
  dueFrom: string;
  dueTo: string;
  createdFrom: string;
  createdTo: string;
  updatedFrom: string;
  updatedTo: string;
}

const OBJECT_TYPE_SET = new Set<string>(OBJECT_TYPES);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseWorkFilters(params: FilterSearchParams): WorkFilterState {
  const type = validCsvValues(params.type, (value) => OBJECT_TYPE_SET.has(value));
  const due = firstParam(params.due);
  const priority = firstParam(params.priority);
  return {
    q: firstParam(params.q),
    type,
    status: validCsvValues(params.status, () => true, canonicalStatusValue),
    stage: validCsvValues(params.stage),
    owner: personParam(params.owner),
    assignee: personParam(params.assignee),
    responsible: personParam(params.responsible),
    lane: firstParam(params.lane),
    priority: PRIORITY_VALUES.some((value) => value === priority) ? priority : '',
    due: DUE_PRESETS.some((value) => value === due) ? (due as DuePreset) : '',
    dueFrom: validDateValue(firstParam(params.dueFrom)),
    dueTo: validDateValue(firstParam(params.dueTo)),
    createdFrom: validDateValue(firstParam(params.createdFrom)),
    createdTo: validDateValue(firstParam(params.createdTo)),
    updatedFrom: validDateValue(firstParam(params.updatedFrom)),
    updatedTo: validDateValue(firstParam(params.updatedTo)),
  };
}

export function objectListFilterFromWorkFilters(
  filters: WorkFilterState,
  now = new Date(),
): ObjectListFilter {
  const due = dueFilter(filters, now);
  return {
    ...(filters.q.trim() ? { query: filters.q.trim() } : {}),
    ...(filters.type ? { type: objectTypeFilter(filters.type) } : {}),
    ...statusFilter(filters.status),
    ...(filters.stage.trim() ? { stage: csvValues(filters.stage) } : {}),
    ...personFilter('ownerUserId', filters.owner),
    ...personFilter('assigneeUserId', filters.assignee),
    ...priorityFilter(filters.priority),
    ...due,
    ...dateRangeFilter('created', filters.createdFrom, filters.createdTo),
    ...dateRangeFilter('updated', filters.updatedFrom, filters.updatedTo),
  };
}

export function taskObjectFilterFromWorkFilters(
  filters: WorkFilterState,
  now = new Date(),
): ObjectListFilter {
  const base = objectListFilterFromWorkFilters({ ...filters, type: 'task' }, now);
  const statuses = filters.status ? taskStatusFilterValues(csvValues(filters.status)) : [];
  return {
    ...base,
    ...(statuses.length > 0 ? { status: statuses } : {}),
    type: 'task',
    archived: false,
  };
}

export function boardItemFilterFromWorkFilters(
  filters: WorkFilterState,
  now = new Date(),
): BoardItemFilter {
  return {
    ...(filters.q.trim() ? { query: filters.q.trim() } : {}),
    ...(filters.lane === NONE_FILTER_VALUE
      ? { laneId: null }
      : filters.lane
        ? { laneId: filters.lane }
        : {}),
    ...boardResponsibleFilter(filters.responsible),
    ...priorityFilter(filters.priority),
    ...dueFilter(filters, now),
    ...dateRangeFilter('created', filters.createdFrom, filters.createdTo),
    ...dateRangeFilter('updated', filters.updatedFrom, filters.updatedTo),
    object: {
      ...(filters.type ? { type: objectTypeFilter(filters.type) } : {}),
      ...statusFilter(filters.status),
      ...(filters.stage.trim() ? { stage: csvValues(filters.stage) } : {}),
      ...personFilter('ownerUserId', filters.owner),
      ...personFilter('assigneeUserId', filters.assignee),
      archived: false,
    },
  };
}

export function hasActiveWorkFilters(filters: WorkFilterState): boolean {
  return Boolean(
    filters.q.trim() ||
    filters.type ||
    filters.status.trim() ||
    filters.stage.trim() ||
    filters.owner ||
    filters.assignee ||
    filters.responsible ||
    filters.lane ||
    filters.priority ||
    filters.due ||
    filters.dueFrom ||
    filters.dueTo ||
    filters.createdFrom ||
    filters.createdTo ||
    filters.updatedFrom ||
    filters.updatedTo,
  );
}

export function workFilterHiddenParams(
  params: FilterSearchParams,
  keepKeys: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keepKeys) {
    const value = firstParam(params[key]);
    if (value) out[key] = value;
  }
  return out;
}

function firstParam(value: string | string[] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first.trim() : '';
}

function personParam(value: string | string[] | undefined): string {
  return validCsvValues(
    value,
    (person) => person === UNASSIGNED_FILTER_VALUE || UUID_RE.test(person),
  );
}

function csvValues(value: string): string[] {
  return value.split(',').flatMap((part) => {
    const trimmed = part.trim();
    return trimmed ? [trimmed] : [];
  });
}

function validCsvValues(
  value: string | string[] | undefined,
  isValid: (value: string) => boolean = () => true,
  normalize: (value: string) => string = (v) => v,
): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paramValues(value)) {
    for (const part of csvValues(raw)) {
      const normalized = normalize(part);
      if (isValid(normalized) && !seen.has(normalized)) {
        seen.add(normalized);
        out.push(normalized);
      }
    }
  }
  return out.join(',');
}

function canonicalStatusValue(value: string): string {
  return value === 'canceled' ? 'cancelled' : value;
}

function paramValues(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const part of value) {
      const trimmed = part.trim();
      if (trimmed) out.push(trimmed);
    }
    return out;
  }
  const first = firstParam(value);
  return first ? [first] : [];
}

function personFilter<K extends 'ownerUserId' | 'assigneeUserId'>(
  key: K,
  value: string,
): Partial<Pick<ObjectListFilter, K>> {
  const people = csvValues(value);
  if (people.length === 0) return {};
  if (people.length === 1 && people[0] === UNASSIGNED_FILTER_VALUE) {
    return { [key]: null } as Pick<ObjectListFilter, K>;
  }
  if (people.length === 1) return { [key]: people[0] } as Pick<ObjectListFilter, K>;
  return {
    [key]: people.map((person) => (person === UNASSIGNED_FILTER_VALUE ? null : person)),
  } as Pick<ObjectListFilter, K>;
}

function objectTypeFilter(value: string): ObjectType | ObjectType[] {
  const types = csvValues(value) as ObjectType[];
  const first = types[0];
  return types.length === 1 && first ? first : types;
}

function statusFilter(value: string): Pick<ObjectListFilter, 'status'> | Record<string, never> {
  const statuses = csvValues(value).flatMap((status) =>
    status === 'cancelled' ? ['cancelled', 'canceled'] : [status],
  );
  const uniqueStatuses = Array.from(new Set(statuses));
  return uniqueStatuses.length > 0 ? { status: uniqueStatuses } : {};
}

function boardResponsibleFilter(
  value: string,
): Pick<BoardItemFilter, 'responsibleUserId'> | Record<string, never> {
  const people = csvValues(value);
  if (people.length === 0) return {};
  if (people.length === 1 && people[0] === UNASSIGNED_FILTER_VALUE)
    return { responsibleUserId: null };
  if (people.length === 1) return { responsibleUserId: people[0] };
  return {
    responsibleUserId: people.map((person) => (person === UNASSIGNED_FILTER_VALUE ? null : person)),
  };
}

function priorityFilter(value: string): Pick<ObjectListFilter, 'priority' | 'priorityNull'> {
  if (value === NONE_FILTER_VALUE) return { priorityNull: true };
  const priority = Number(value);
  return Number.isInteger(priority) && priority >= 1 && priority <= 4 ? { priority } : {};
}

function dueFilter(
  filters: Pick<WorkFilterState, 'due' | 'dueFrom' | 'dueTo'>,
  now: Date,
): Pick<ObjectListFilter, 'dueAfter' | 'dueBefore' | 'dueNull'> {
  if (filters.due === 'none') return { dueNull: true };
  if (filters.due === 'overdue') return { dueBefore: now };
  if (filters.due === 'today') {
    const start = startOfUtcDay(now);
    return { dueAfter: start, dueBefore: addUtcDays(start, 1) };
  }
  if (filters.due === 'next7')
    return { dueAfter: startOfUtcDay(now), dueBefore: addUtcDays(now, 7) };
  if (filters.due === 'range' || filters.dueFrom || filters.dueTo) {
    return {
      ...(filters.dueFrom ? { dueAfter: dateValueToUtc(filters.dueFrom) } : {}),
      ...(filters.dueTo ? { dueBefore: addUtcDays(dateValueToUtc(filters.dueTo), 1) } : {}),
    };
  }
  return {};
}

function dateRangeFilter(
  field: 'created' | 'updated',
  from: string,
  to: string,
): Pick<ObjectListFilter, 'createdAfter' | 'createdBefore' | 'updatedAfter' | 'updatedBefore'> {
  if (!from && !to) return {};
  if (field === 'created') {
    return {
      ...(from ? { createdAfter: dateValueToUtc(from) } : {}),
      ...(to ? { createdBefore: addUtcDays(dateValueToUtc(to), 1) } : {}),
    };
  }
  return {
    ...(from ? { updatedAfter: dateValueToUtc(from) } : {}),
    ...(to ? { updatedBefore: addUtcDays(dateValueToUtc(to), 1) } : {}),
  };
}

function validDateValue(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function dateValueToUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}
