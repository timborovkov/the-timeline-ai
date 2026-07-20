import { OBJECT_TYPES } from '@timeline/shared/objects/types';
import {
  TASK_CATEGORIES,
  UNCATEGORIZED_TASK_CATEGORY_FILTER,
  type TaskCategory,
  type TaskCategoryFilterKey,
} from '@timeline/shared/task-categories/types';
import { workspaceDueDateBoundaries } from '@timeline/shared/time';

import type { BoardItemFilter } from '@timeline/shared/boards';
import type { ObjectListFilter, ObjectType } from '@timeline/shared/objects/types';

import { TASK_OPEN_STATUSES_EXCLUDED } from '@/lib/task-board-config';
import { taskStatusFilterValues } from '@/lib/task-statuses';

export const UNASSIGNED_FILTER_VALUE = 'unassigned';
export const NONE_FILTER_VALUE = 'none';
const UNCATEGORIZED_FILTER_VALUE = UNCATEGORIZED_TASK_CATEGORY_FILTER;
const DUE_PRESETS = ['overdue', 'today', 'next7', 'none', 'range'] as const;
const PRIORITY_VALUES = ['1', '2', '3', '4', NONE_FILTER_VALUE] as const;
export const WORK_FILTER_PARAM_KEYS = [
  'q',
  'type',
  'status',
  'category',
  'project',
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
  category: string;
  project: string;
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

interface WorkFilterTimeContext {
  now?: Date;
  timezone?: string;
}

type WorkFilterTimeInput = Date | WorkFilterTimeContext;

const OBJECT_TYPE_SET = new Set<string>(OBJECT_TYPES);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseWorkFilters(
  params: FilterSearchParams,
  options: { taskCategoriesEnabled?: boolean } = {},
): WorkFilterState {
  const type = validCsvValues(params.type, (value) => OBJECT_TYPE_SET.has(value));
  const due = firstParam(params.due);
  const priority = firstParam(params.priority);
  const category =
    options.taskCategoriesEnabled === false
      ? ''
      : validCsvValues(
          params.category,
          (value) =>
            value === UNCATEGORIZED_FILTER_VALUE || TASK_CATEGORIES.includes(value as TaskCategory),
        );
  return {
    q: firstParam(params.q),
    type,
    status: validCsvValues(params.status, () => true, canonicalStatusValue),
    category,
    project: validCsvValues(params.project, (value) => UUID_RE.test(value)),
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
  time: WorkFilterTimeInput = {},
): ObjectListFilter {
  const due = dueFilter(filters, timeContext(time));
  return {
    ...(filters.q.trim() ? { query: filters.q.trim() } : {}),
    ...(filters.type ? { type: objectTypeFilter(filters.type) } : {}),
    ...statusFilter(filters.status),
    ...categoryFilter(filters.category),
    ...(filters.project ? { primaryProjectId: csvValues(filters.project) } : {}),
    ...(filters.stage.trim() ? { stage: csvValues(filters.stage) } : {}),
    ...personFilter('ownerUserId', filters.owner),
    ...personFilter('assigneeUserId', filters.assignee),
    ...priorityFilter(filters.priority),
    ...due,
    ...dateRangeFilter('created', filters.createdFrom, filters.createdTo),
    ...dateRangeFilter('updated', filters.updatedFrom, filters.updatedTo),
  };
}

export function taskCategoryFilterKeys(filters: WorkFilterState): TaskCategoryFilterKey[] {
  return filters.category
    .split(',')
    .filter(
      (value): value is TaskCategoryFilterKey =>
        value === UNCATEGORIZED_FILTER_VALUE || TASK_CATEGORIES.includes(value as TaskCategory),
    );
}

export function taskObjectFilterFromWorkFilters(
  filters: WorkFilterState,
  time: WorkFilterTimeInput = {},
): ObjectListFilter {
  const base = objectListFilterFromWorkFilters({ ...filters, type: 'task' }, time);
  const statuses = filters.status ? taskStatusFilterValues(csvValues(filters.status)) : [];
  return {
    ...base,
    ...(statuses.length > 0 ? { status: statuses } : {}),
    ...(filters.due === 'overdue' && statuses.length === 0
      ? { statusNotCaseInsensitive: [...TASK_OPEN_STATUSES_EXCLUDED] }
      : {}),
    type: 'task',
    archived: false,
  };
}

export function boardItemFilterFromWorkFilters(
  filters: WorkFilterState,
  time: WorkFilterTimeInput = {},
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
    ...dueFilter(filters, timeContext(time)),
    ...dateRangeFilter('created', filters.createdFrom, filters.createdTo),
    ...dateRangeFilter('updated', filters.updatedFrom, filters.updatedTo),
    object: {
      ...(filters.type ? { type: objectTypeFilter(filters.type) } : {}),
      ...statusFilter(filters.status),
      ...categoryFilter(filters.category),
      ...(filters.project ? { primaryProjectId: csvValues(filters.project) } : {}),
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
    filters.category ||
    filters.project ||
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

function categoryFilter(
  value: string,
): Pick<ObjectListFilter, 'taskCategory' | 'taskCategoryNull'> {
  const values = csvValues(value);
  const categories = values.filter(
    (category): category is TaskCategory => category !== UNCATEGORIZED_FILTER_VALUE,
  );
  return {
    ...(categories.length > 0 ? { taskCategory: categories } : {}),
    ...(values.includes(UNCATEGORIZED_FILTER_VALUE) ? { taskCategoryNull: true } : {}),
  };
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
  context: Required<WorkFilterTimeContext>,
): Pick<ObjectListFilter, 'dueDateRange' | 'dueNull'> {
  if (filters.due === 'none') return { dueNull: true };
  const boundaries = workspaceDueDateBoundaries(context.timezone, context.now);
  if (filters.due === 'overdue') {
    return { dueDateRange: { timezone: context.timezone, to: boundaries.today } };
  }
  if (filters.due === 'today') {
    return {
      dueDateRange: {
        timezone: context.timezone,
        from: boundaries.today,
        to: boundaries.tomorrow,
      },
    };
  }
  if (filters.due === 'next7') {
    return {
      dueDateRange: {
        timezone: context.timezone,
        from: boundaries.today,
        to: boundaries.next7,
      },
    };
  }
  if (filters.due === 'range' || filters.dueFrom || filters.dueTo) {
    return {
      dueDateRange: {
        timezone: context.timezone,
        ...(filters.dueFrom ? { from: filters.dueFrom } : {}),
        ...(filters.dueTo ? { to: dateValueAfter(filters.dueTo) } : {}),
      },
    };
  }
  return {};
}

function timeContext(input: WorkFilterTimeInput): Required<WorkFilterTimeContext> {
  if (input instanceof Date) return { now: input, timezone: 'UTC' };
  return { now: input.now ?? new Date(), timezone: input.timezone ?? 'UTC' };
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

function dateValueAfter(value: string): string {
  return addUtcDays(dateValueToUtc(value), 1).toISOString().slice(0, 10);
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}
