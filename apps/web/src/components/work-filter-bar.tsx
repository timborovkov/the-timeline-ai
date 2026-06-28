'use client';

import { Filter, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useMemo } from 'react';

import type { MemberFilterOption, WorkFilterState } from '@/lib/work-filters';
import type * as boards from '@timeline/shared/boards';
import type { ReactNode, SyntheticEvent } from 'react';

import { FilterMultiSelect } from '@/components/filter-multi-select';
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
  lanes?: boards.BoardLaneRow[];
  typeLabels?: Record<string, string>;
  statusOptions?: readonly string[];
  className?: string;
}

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
  'canceled',
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
  lanes = EMPTY_LANES,
  typeLabels = EMPTY_LABELS,
  statusOptions = EMPTY_STATUS_OPTIONS,
  className,
}: Props) {
  const router = useRouter();
  const formId = useId();
  const clearHref = useMemo(() => hrefWithParams(basePath, hiddenParams), [basePath, hiddenParams]);
  const hasRangeFilters = Boolean(
    filters.dueFrom ||
    filters.dueTo ||
    filters.createdFrom ||
    filters.createdTo ||
    filters.updatedFrom ||
    filters.updatedTo,
  );

  function onSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const params = new URLSearchParams(hiddenParams);
    const formData = new FormData(event.currentTarget);
    for (const [key, raw] of formData.entries()) {
      if (key.startsWith('__')) continue;
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (!value) {
        params.delete(key);
        continue;
      }
      params.set(key, value);
    }
    router.push(hrefWithParams(basePath, Object.fromEntries(params.entries())));
  }

  return (
    <form
      id={formId}
      onSubmit={onSubmit}
      className={cn(
        'border-y border-border bg-bg/80 px-4 py-3 md:px-8',
        mode === 'objects' && 'px-0 md:px-0',
        className,
      )}
    >
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <label className="relative min-w-[15rem] flex-1 sm:max-w-xs">
            <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
              Search
            </span>
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
                  ? 'Search board items...'
                  : mode === 'tasks'
                    ? 'Search tasks...'
                    : 'Search objects...'
              }
              className="h-9 w-full rounded-sm border border-border bg-surface py-1 pl-8 pr-2 text-sm text-fg outline-none transition-colors placeholder:text-fg-dim focus:border-signal/60"
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
          >
            <option value="">Any due date</option>
            <option value="overdue">Overdue</option>
            <option value="today">Today</option>
            <option value="next7">Next 7 days</option>
            <option value="none">No due date</option>
            <option value="range">Date range</option>
          </FilterSelect>

          <details className="min-w-full" open={hasRangeFilters || undefined}>
            <summary className="inline-flex h-9 cursor-pointer select-none items-center rounded-sm border border-border bg-surface px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted transition-colors hover:border-border-strong hover:text-fg">
              Date ranges
            </summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
                defaultValue={filters.updatedTo}
                type="date"
              />
            </div>
          </details>
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:justify-end xl:pt-[1.125rem]">
          <output
            className="mr-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim"
            aria-live="polite"
          >
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
          <button
            type="submit"
            className="inline-flex h-9 items-center gap-2 rounded-sm border border-signal/50 bg-signal px-3 text-xs font-medium text-signal-fg transition-colors hover:bg-signal/90"
          >
            <Filter className="size-3.5" aria-hidden />
            Apply
          </button>
        </div>
      </div>
    </form>
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
  if (statusOptions.length === 0) {
    return (
      <StatusMultiSelect defaultValue={defaultValue} mode={mode} options={COMMON_STATUS_OPTIONS} />
    );
  }
  return <StatusMultiSelect defaultValue={defaultValue} mode={mode} options={statusOptions} />;
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
      defaultValue={defaultValue}
      placeholder="Any status"
      options={options.map((status) => ({ value: status, label: status }))}
    />
  );
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
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
        {label}
      </span>
      <select
        name={name}
        defaultValue={defaultValue}
        onChange={(event) => onChange?.(event.currentTarget.value)}
        className="h-9 w-full rounded-sm border border-border bg-surface px-2 text-xs text-fg outline-none transition-colors focus:border-signal/60"
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
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
        {label}
      </span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="h-9 w-full rounded-sm border border-border bg-surface px-2 text-xs text-fg outline-none transition-colors placeholder:text-fg-dim focus:border-signal/60"
      />
    </label>
  );
}

function hrefWithParams(basePath: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
