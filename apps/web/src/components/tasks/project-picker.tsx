'use client';

import { Check, ChevronDown, Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import type { KeyboardEvent } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useProjectSearch } from '@/hooks/use-project-search';
import { cn } from '@/lib/utils';

interface ProjectOption {
  id: string;
  label: string;
}

export function ProjectPicker({
  value,
  selectedLabel,
  selectedArchived = false,
  projects,
  disabled = false,
  onValueChange,
  ariaLabel = 'Task project',
  className,
}: {
  value: string | null;
  selectedLabel?: string | undefined;
  selectedArchived?: boolean;
  projects: ProjectOption[];
  disabled?: boolean;
  onValueChange: (project: ProjectOption | null) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionListRef = useRef<HTMLUListElement>(null);
  const { query, setQuery, projects: remoteProjects } = useProjectSearch();
  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matches = normalized
      ? [
          ...projects.filter(
            (project) => project.id === value || project.label.toLowerCase().includes(normalized),
          ),
          ...remoteProjects,
        ]
      : projects;
    const candidates =
      value && selectedLabel ? [...matches, { id: value, label: selectedLabel }] : matches;
    return [...new Map(candidates.map((project) => [project.id, project])).values()];
  }, [projects, query, remoteProjects, selectedLabel, value]);
  const selectedProject = visibleProjects.find((project) => project.id === value);
  const triggerLabel = value
    ? `${selectedProject?.label ?? selectedLabel ?? value}${selectedArchived ? ' · Archived' : ''}`
    : 'No project';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${ariaLabel}: ${triggerLabel}`}
          disabled={disabled}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-sm border border-border bg-bg px-2 text-left text-sm text-fg outline-none transition-colors hover:border-border-strong focus-visible:border-signal/60 focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-progress disabled:opacity-60',
            !value && 'text-fg-muted',
            className,
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="size-3.5 shrink-0 text-fg-dim" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        role="dialog"
        aria-label={`${ariaLabel} choices`}
        className="w-[var(--radix-popover-trigger-width)] min-w-56"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <div className="relative p-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-fg-dim"
            aria-hidden
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return;
              event.preventDefault();
              focusProjectOption(optionListRef.current, 'first');
            }}
            placeholder="Search projects…"
            aria-label="Search task projects"
            className="h-8 w-full rounded-sm border border-border bg-bg py-1 pl-8 pr-2 text-xs text-fg outline-none placeholder:text-fg-dim focus-visible:border-signal/60 focus-visible:ring-2 focus-visible:ring-signal/40"
          />
        </div>
        <div className="-mx-1 my-1 h-px bg-muted" />
        <ul
          ref={optionListRef}
          data-picker-list
          aria-label="Projects"
          className="max-h-64 overflow-y-auto"
        >
          <li className="mb-1 border-b border-muted pb-1">
            <button
              type="button"
              data-picker-option
              aria-pressed={!value}
              onClick={() => {
                onValueChange(null);
                setOpen(false);
              }}
              onKeyDown={handleProjectOptionKeyDown}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent focus:bg-accent focus:text-accent-foreground"
            >
              <Check className={cn('size-4', value ? 'invisible' : 'visible')} aria-hidden />
              No project
            </button>
          </li>
          {visibleProjects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                data-picker-option
                aria-pressed={project.id === value}
                onClick={() => {
                  onValueChange(project);
                  setOpen(false);
                }}
                onKeyDown={handleProjectOptionKeyDown}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent focus:bg-accent focus:text-accent-foreground"
              >
                <Check
                  className={cn('size-4', project.id === value ? 'visible' : 'invisible')}
                  aria-hidden
                />
                <span className="truncate">{project.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function handleProjectOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const optionList = event.currentTarget.closest<HTMLElement>('[data-picker-list]');
  if (!optionList) return;
  const direction =
    event.key === 'Home'
      ? 'first'
      : event.key === 'End'
        ? 'last'
        : event.key === 'ArrowDown'
          ? 'next'
          : 'previous';
  focusProjectOption(optionList, direction, event.currentTarget);
}

function focusProjectOption(
  optionList: HTMLElement | null,
  direction: 'first' | 'last' | 'next' | 'previous',
  current?: HTMLElement,
): void {
  if (!optionList) return;
  const options = Array.from(optionList.querySelectorAll<HTMLElement>('[data-picker-option]'));
  if (options.length === 0) return;
  if (direction === 'first') options[0]?.focus();
  else if (direction === 'last') options.at(-1)?.focus();
  else {
    const index = current ? options.indexOf(current) : -1;
    const offset = direction === 'next' ? 1 : -1;
    options[(index + offset + options.length) % options.length]?.focus();
  }
}
