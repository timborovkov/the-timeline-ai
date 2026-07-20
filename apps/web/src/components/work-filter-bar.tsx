'use client';

import { TASK_CATEGORY_OPTIONS } from '@timeline/shared/task-categories/types';
import { ChevronDown, Search, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import type { MemberFilterOption, WorkFilterState } from '@/lib/work-filters';
import type * as boards from '@timeline/shared/boards';
import type { ReactNode } from 'react';

import { DebouncedFilterForm } from '@/components/debounced-filter-form';
import { FilterMultiSelect } from '@/components/filter-multi-select';
import { useProjectSearch } from '@/hooks/use-project-search';
import { displayText } from '@/lib/display-dates';
import { cn } from '@/lib/utils';
import { NONE_FILTER_VALUE, UNASSIGNED_FILTER_VALUE } from '@/lib/work-filters';

interface Props {
  mode: 'tasks' | 'board' | 'objects';
  basePath: string;
  filters: WorkFilterState;
  active: boolean;
  resultCount: number;
  totalCount: number;
  hiddenParams?: Record<string, string>;
  members?: MemberFilterOption[];
  projects?: MemberFilterOption[];
  lanes?: boards.BoardLaneRow[];
  typeLabels?: Record<string, string>;
  statusOptions?: readonly string[];
  className?: string;
}

type DateRangeToggle =
  | { state: 'auto' }
  | { state: 'open' }
  | { state: 'closed'; filterKey: string };

const EMPTY_PARAMS: Record<string, string> = {};
const EMPTY_MEMBERS: MemberFilterOption[] = [];
const EMPTY_LANES: boards.BoardLaneRow[] = [];
const EMPTY_LABELS: Record<string, string> = {};
const EMPTY_STATUS_OPTIONS: readonly string[] = [];
const COMMON_STATUS_OPTIONS = [
  'suggested',
  'proposed',
  'open',
  'active',
  'todo',
  'doing',
  'blocked',
  'pending',
  'ready',
  'done',
  'shipped',
  'cancelled',
  'archived',
] as const;

export function WorkFilterBar({
  mode,
  basePath,
  filters,
  active,
  resultCount,
  totalCount,
  hiddenParams = EMPTY_PARAMS,
  members = EMPTY_MEMBERS,
  projects = EMPTY_MEMBERS,
  lanes = EMPTY_LANES,
  typeLabels = EMPTY_LABELS,
  statusOptions = EMPTY_STATUS_OPTIONS,
  className,
}: Props) {
  const formId = useId();
  const filterKey = workFilterStateKey(filters);
  const clearHref = useMemo(() => hrefWithParams(basePath, hiddenParams), [basePath, hiddenParams]);
  const hasRangeFilters = Boolean(
    filters.due === 'range' ||
    filters.dueFrom ||
    filters.dueTo ||
    filters.createdFrom ||
    filters.createdTo ||
    filters.updatedFrom ||
    filters.updatedTo,
  );
  const [dateRangeToggle, setDateRangeToggle] = useState<DateRangeToggle>({ state: 'auto' });
  const dateRangesManuallyClosed =
    dateRangeToggle.state === 'closed' && dateRangeToggle.filterKey === filterKey;
  const showDateRanges =
    dateRangeToggle.state === 'open' || (hasRangeFilters && !dateRangesManuallyClosed);

  return (
    <DebouncedFilterForm
      key={filterKey}
      basePath={basePath}
      preservedParams={hiddenParams}
      className={cn(
        'border-y border-border bg-bg/80 px-4 py-3 md:px-8',
        mode === 'objects' && 'px-0 md:px-0',
        className,
      )}
    >
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <label className="relative min-w-[15rem] flex-1 sm:max-w-xs">
            <span className="mb-1 block text-[11px] text-fg-dim">Search</span>
            <Search
              className="pointer-events-none absolute bottom-2.5 left-2.5 size-3.5 text-fg-dim"
              aria-hidden
            />
            <input
              name="q"
              type="search"
              defaultValue={filters.q}
              placeholder={
                mode === 'board'
                  ? 'Search board items…'
                  : mode === 'tasks'
                    ? 'Search tasks…'
                    : 'Search objects…'
              }
              className="h-9 w-full rounded-sm border border-border bg-surface py-1 pl-8 pr-2 text-sm text-fg outline-none transition-colors placeholder:text-fg-dim focus-visible:border-signal/60 focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            />
          </label>

          {mode === 'board' ? (
            <FilterSelect name="lane" label="Lane" defaultValue={filters.lane}>
              <option value="">Any lane</option>
              <option value={NONE_FILTER_VALUE}>Unset</option>
              {lanes.map((lane) => (
                <option key={lane.id} value={lane.id}>
                  {displayText(lane.name)}
                </option>
              ))}
            </FilterSelect>
          ) : null}

          {mode === 'objects' || mode === 'board' ? (
            <FilterMultiSelect
              key={`type:${filters.type}`}
              name="type"
              label={mode === 'board' ? 'Object type' : 'Type'}
              defaultValue={filters.type}
              placeholder="Any type"
              options={Object.entries(typeLabels).map(([value, label]) => ({ value, label }))}
            />
          ) : null}

          <StatusControl defaultValue={filters.status} mode={mode} statusOptions={statusOptions} />

          <div className="task-category-ui">
            <FilterMultiSelect
              key={`category:${filters.category}`}
              name="category"
              label="Category"
              defaultValue={filters.category}
              placeholder="Any category"
              options={[
                ...TASK_CATEGORY_OPTIONS,
                { value: 'uncategorized', label: 'Uncategorized' },
              ]}
            />
          </div>

          <ProjectFilterControl
            key={`project:${filters.project}`}
            defaultValue={filters.project}
            projects={projects}
          />

          {mode === 'objects' ? (
            <FilterInput
              name="stage"
              label="Stage"
              defaultValue={filters.stage}
              placeholder="Any stage"
            />
          ) : null}

          {mode === 'objects' ? (
            <PersonSelect
              name="owner"
              label="Owner"
              defaultValue={filters.owner}
              members={members}
            />
          ) : null}

          {mode === 'board' ? (
            <PersonSelect
              name="responsible"
              label="Responsible"
              defaultValue={filters.responsible}
              members={members}
            />
          ) : (
            <PersonSelect
              name="assignee"
              label="Assignee"
              defaultValue={filters.assignee}
              members={members}
            />
          )}

          {mode === 'board' ? (
            <PersonSelect
              name="assignee"
              label="Object assignee"
              defaultValue={filters.assignee}
              members={members}
            />
          ) : null}

          <FilterSelect name="priority" label="Priority" defaultValue={filters.priority}>
            <option value="">Any priority</option>
            <option value={NONE_FILTER_VALUE}>No priority</option>
            {[1, 2, 3, 4].map((priority) => (
              <option key={priority} value={priority}>
                P{priority}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect
            name="due"
            label={mode === 'board' ? 'Board due' : 'Due'}
            defaultValue={filters.due}
            onChange={(value) => {
              if (value === 'range') setDateRangeToggle({ state: 'open' });
            }}
          >
            <option value="">Any due date</option>
            <option value="overdue">Overdue</option>
            <option value="today">Today</option>
            <option value="next7">Next 7 days</option>
            <option value="none">No due date</option>
            <option value="range">Date range</option>
          </FilterSelect>

          <button
            type="button"
            aria-expanded={showDateRanges}
            aria-controls={`${formId}-date-ranges`}
            onClick={() => {
              setDateRangeToggle(
                showDateRanges ? { state: 'closed', filterKey } : { state: 'open' },
              );
            }}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg focus-visible:border-signal/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              (showDateRanges || hasRangeFilters) && 'border-border-strong text-fg',
            )}
          >
            Date ranges
            <ChevronDown
              className={cn(
                'size-3.5 text-fg-dim transition-transform',
                showDateRanges && 'rotate-180',
              )}
              aria-hidden
            />
          </button>

          <div
            id={`${formId}-date-ranges`}
            hidden={!showDateRanges}
            className="grid min-w-full gap-2 pt-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
          >
            <FilterInput
              name="dueFrom"
              label="Due from"
              defaultValue={filters.dueFrom}
              type="date"
            />
            <FilterInput name="dueTo" label="Due to" defaultValue={filters.dueTo} type="date" />
            <FilterInput
              name="createdFrom"
              label={mode === 'board' ? 'Item created from' : 'Created from'}
              defaultValue={filters.createdFrom}
              type="date"
            />
            <FilterInput
              name="createdTo"
              label={mode === 'board' ? 'Item created to' : 'Created to'}
              defaultValue={filters.createdTo}
              type="date"
            />
            <FilterInput
              name="updatedFrom"
              label={mode === 'board' ? 'Item updated from' : 'Updated from'}
              defaultValue={filters.updatedFrom}
              type="date"
            />
            <FilterInput
              name="updatedTo"
              label={mode === 'board' ? 'Item updated to' : 'Updated to'}
              type="date"
              defaultValue={filters.updatedTo}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:justify-end xl:pt-[1.125rem]">
          <output className="mr-1 text-xs text-fg-dim" aria-live="polite">
            {active ? `${resultCount} / ${totalCount}` : `${totalCount} visible`}
          </output>
          {active ? (
            <a
              href={clearHref}
              className="inline-flex h-9 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-xs font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
            >
              <X className="size-3.5" aria-hidden />
              Clear
            </a>
          ) : null}
        </div>
      </div>
    </DebouncedFilterForm>
  );
}

function ProjectFilterControl({
  defaultValue,
  projects,
}: {
  defaultValue: string;
  projects: MemberFilterOption[];
}) {
  const { query, setQuery, projects: searchResults } = useProjectSearch();
  const options = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const selectedIds = new Set(defaultValue.split(','));
    const byId = new Map<string, MemberFilterOption>();
    for (const project of projects) {
      if (
        normalized &&
        !selectedIds.has(project.id) &&
        !project.label.toLowerCase().includes(normalized)
      ) {
        continue;
      }
      byId.set(project.id, project);
    }
    for (const project of searchResults) byId.set(project.id, project);
    return [...byId.values()].map((project) => ({ value: project.id, label: project.label }));
  }, [defaultValue, projects, query, searchResults]);

  return (
    <FilterMultiSelect
      name="project"
      label="Project"
      defaultValue={defaultValue}
      placeholder="Any project"
      options={options}
      className="min-w-44"
      search={{
        value: query,
        onValueChange: setQuery,
        placeholder: 'Search projects…',
        ariaLabel: 'Search project filters',
      }}
    />
  );
}

function StatusControl({
  defaultValue,
  mode,
  statusOptions,
}: {
  defaultValue: string;
  mode: Props['mode'];
  statusOptions: readonly string[];
}) {
  return (
    <StatusMultiSelect
      defaultValue={defaultValue}
      mode={mode}
      options={dedupeStatusOptions(
        statusOptions.length === 0 ? COMMON_STATUS_OPTIONS : statusOptions,
      )}
    />
  );
}

function StatusMultiSelect({
  defaultValue,
  mode,
  options,
}: {
  defaultValue: string;
  mode: Props['mode'];
  options: readonly string[];
}) {
  return (
    <FilterMultiSelect
      key={`status:${defaultValue}`}
      name="status"
      label={mode === 'board' ? 'Object status' : 'Status'}
      defaultValue={normalizeStatusValue(defaultValue)}
      placeholder="Any status"
      options={options.map((status) => ({ value: status, label: status }))}
    />
  );
}

function dedupeStatusOptions(options: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const status of options) {
    const canonical = status === 'canceled' ? 'cancelled' : status;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

function normalizeStatusValue(value: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const status of value.split(',')) {
    const canonical = status.trim() === 'canceled' ? 'cancelled' : status.trim();
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out.join(',');
}

function PersonSelect({
  name,
  label,
  defaultValue,
  members,
}: {
  name: string;
  label: string;
  defaultValue: string;
  members: MemberFilterOption[];
}) {
  return (
    <FilterMultiSelect
      key={`${name}:${defaultValue}`}
      name={name}
      label={label}
      defaultValue={defaultValue}
      placeholder="Anyone"
      options={[
        { value: UNASSIGNED_FILTER_VALUE, label: 'Unassigned' },
        ...members.map((member) => ({ value: member.id, label: member.label })),
      ]}
    />
  );
}

function FilterSelect({
  name,
  label,
  defaultValue,
  children,
  onChange,
}: {
  name: string;
  label: string;
  defaultValue: string;
  children: ReactNode;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="min-w-32">
      <span className="mb-1 block text-[11px] text-fg-dim">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        onChange={(event) => onChange?.(event.currentTarget.value)}
        className="h-9 w-full rounded-sm border border-border bg-surface px-2 text-xs text-fg outline-none transition-colors focus-visible:border-signal/60 focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        {children}
      </select>
    </label>
  );
}

function FilterInput({
  name,
  label,
  defaultValue,
  placeholder,
  type = 'text',
}: {
  name: string;
  label: string;
  defaultValue: string;
  placeholder?: string;
  type?: 'text' | 'date';
}) {
  return (
    <label className={type === 'date' ? 'min-w-36' : 'min-w-32'}>
      <span className="mb-1 block text-[11px] text-fg-dim">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="h-9 w-full rounded-sm border border-border bg-surface px-2 text-xs text-fg outline-none transition-colors placeholder:text-fg-dim focus-visible:border-signal/60 focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      />
    </label>
  );
}

function hrefWithParams(basePath: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function workFilterStateKey(filters: WorkFilterState): string {
  return [
    filters.q,
    filters.type,
    filters.status,
    filters.category,
    filters.project,
    filters.stage,
    filters.owner,
    filters.assignee,
    filters.responsible,
    filters.lane,
    filters.priority,
    filters.due,
    filters.dueFrom,
    filters.dueTo,
    filters.createdFrom,
    filters.createdTo,
    filters.updatedFrom,
    filters.updatedTo,
  ].join('\0');
}
