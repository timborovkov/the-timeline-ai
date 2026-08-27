'use client';

import { Check, ChevronDown, Search } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';

import type { KeyboardEvent, Ref } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCompanySearch } from '@/hooks/use-company-search';
import { cn } from '@/lib/utils';

interface CompanyOption {
  id: string;
  label: string;
}

export function CompanyPicker({
  value,
  selectedLabel,
  selectedArchived = false,
  companies,
  disabled = false,
  onValueChange,
  ariaLabel = 'Person company',
  ariaDescribedBy,
  triggerRef,
  className,
}: {
  value: string | null;
  selectedLabel?: string | undefined;
  selectedArchived?: boolean;
  companies: CompanyOption[];
  disabled?: boolean;
  onValueChange: (company: CompanyOption | null) => void;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  triggerRef?: Ref<HTMLButtonElement>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionListRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const searchStatusId = useId();
  const companySearch = useCompanySearch();
  const { query, setQuery, companies: remoteCompanies, retry } = companySearch;
  const searchStatus = companySearch.status;
  const matchingCompanies = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matches = normalized
      ? [
          ...companies.filter((company) => company.label.toLowerCase().includes(normalized)),
          ...remoteCompanies,
        ]
      : companies;
    return [...new Map(matches.map((company) => [company.id, company])).values()];
  }, [companies, query, remoteCompanies]);
  const visibleCompanies = useMemo(() => {
    const candidates =
      value && selectedLabel
        ? [...matchingCompanies, { id: value, label: selectedLabel }]
        : matchingCompanies;
    return [...new Map(candidates.map((company) => [company.id, company])).values()];
  }, [matchingCompanies, selectedLabel, value]);
  const selectedCompany = visibleCompanies.find((company) => company.id === value);
  const triggerLabel = value
    ? `${selectedCompany?.label ?? selectedLabel ?? value}${selectedArchived ? ' · Archived' : ''}`
    : 'No company';
  const normalizedQuery = query.trim();
  const resultMessage = companySearchMessage({
    query: normalizedQuery,
    resultCount: matchingCompanies.length,
    status: searchStatus,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={`${ariaLabel}: ${triggerLabel}`}
          aria-describedby={ariaDescribedBy}
          aria-busy={disabled || searchStatus === 'loading' ? true : undefined}
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
        className="w-[min(var(--radix-popover-trigger-width),calc(100vw-1.5rem))] min-w-0 sm:min-w-56"
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
              focusCompanyOption(optionListRef.current, 'first');
            }}
            placeholder="Search companies…"
            aria-label="Search companies"
            aria-describedby={searchStatusId}
            className="h-8 w-full rounded-sm border border-border bg-bg py-1 pl-8 pr-2 text-xs text-fg outline-none placeholder:text-fg-dim focus-visible:border-signal/60 focus-visible:ring-2 focus-visible:ring-signal/40"
          />
        </div>
        <div className="-mx-1 my-1 h-px bg-muted" />
        <p id={searchStatusId} role="status" className="px-2 pb-1 text-xs text-fg-muted">
          {resultMessage}
        </p>
        {searchStatus === 'error' ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 px-2 pb-1 text-xs text-danger"
          >
            <span>Unable to search companies.</span>
            <button
              type="button"
              onClick={retry}
              className="shrink-0 rounded-sm font-medium text-danger underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Retry
            </button>
          </div>
        ) : null}
        <ul
          ref={optionListRef}
          id={listId}
          data-picker-list
          aria-label="Companies"
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
              onKeyDown={handleCompanyOptionKeyDown}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-inset"
            >
              <Check className={cn('size-4', value ? 'invisible' : 'visible')} aria-hidden />
              No company
            </button>
          </li>
          {visibleCompanies.map((company) => (
            <li key={company.id}>
              <button
                type="button"
                data-picker-option
                aria-pressed={company.id === value}
                onClick={() => {
                  onValueChange(company);
                  setOpen(false);
                }}
                onKeyDown={handleCompanyOptionKeyDown}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-inset"
              >
                <Check
                  className={cn('size-4', company.id === value ? 'visible' : 'invisible')}
                  aria-hidden
                />
                <span className="truncate">{company.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function companySearchMessage({
  query,
  resultCount,
  status,
}: {
  query: string;
  resultCount: number;
  status: 'idle' | 'loading' | 'success' | 'error';
}): string {
  if (query.length === 0) {
    return resultCount === 1
      ? '1 company shown. Search to find other companies.'
      : `${String(resultCount)} companies shown. Search to find other companies.`;
  }
  if (query.length === 1) return 'Type one more character to search all companies.';
  if (status === 'loading') return 'Searching companies…';
  if (status === 'error') return 'Company search failed.';
  if (resultCount === 0) return 'No matching companies.';
  return resultCount === 1 ? '1 matching company.' : `${String(resultCount)} matching companies.`;
}

function handleCompanyOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
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
  focusCompanyOption(optionList, direction, event.currentTarget);
}

function focusCompanyOption(
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
