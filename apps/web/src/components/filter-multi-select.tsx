'use client';

import { Check, ChevronDown, Search } from 'lucide-react';
import { useId, useMemo, useReducer, useRef } from 'react';

import type { KeyboardEvent, ReactNode } from 'react';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { selectedValues } from '@/lib/filter-values';
import { cn } from '@/lib/utils';

export interface FilterMultiSelectOption {
  value: string;
  label: string;
}

type SelectedAction = { type: 'checked'; value: string; checked: boolean } | { type: 'clear' };

interface FilterMultiSelectProps {
  label: string;
  placeholder: string;
  options: readonly FilterMultiSelectOption[];
  name?: string;
  value?: string;
  defaultValue?: string;
  className?: string;
  triggerClassName?: string;
  onValueChange?: (value: string) => void;
  form?: string;
  search?: {
    value: string;
    onValueChange: (value: string) => void;
    placeholder: string;
    ariaLabel: string;
  };
}

export function FilterMultiSelect({
  label,
  placeholder,
  options,
  name,
  value,
  defaultValue = '',
  className,
  triggerClassName,
  onValueChange,
  search,
  form,
}: FilterMultiSelectProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selectionDescriptionId = useId();
  const selectedSource = value ?? defaultValue;
  const normalizedOptions = useMemo(
    () => optionsWithSelectedValues(options, selectedSource),
    [options, selectedSource],
  );
  const [internalSelected, dispatchInternalSelected] = useReducer(
    selectedReducer,
    selectedValues(defaultValue, normalizedOptions).join(','),
  );
  const controlled = value !== undefined;
  const selected = controlled
    ? selectedValues(value, normalizedOptions).join(',')
    : internalSelected;
  const selectedList = useMemo(
    () => selectedValues(selected, normalizedOptions),
    [selected, normalizedOptions],
  );
  const selectedSet = useMemo(() => new Set(selectedList), [selectedList]);
  const optionLabel = useMemo(
    () => new Map(normalizedOptions.map((option) => [option.value, option.label])),
    [normalizedOptions],
  );
  const selectedLabels = selectedList.map(
    (selectedValue) => optionLabel.get(selectedValue) ?? selectedValue,
  );
  const buttonText =
    selectedList.length === 0
      ? placeholder
      : selectedList.length === 1
        ? (optionLabel.get(selectedList[0] ?? '') ?? selectedList[0])
        : `${selectedList.length} selected`;
  const selectionDescription =
    selectedLabels.length === 0
      ? `No selection. ${placeholder}.`
      : `Selected: ${selectedLabels.join(', ')}.`;

  function applySelected(action: SelectedAction): void {
    const next = selectedReducer(selected, action);
    if (!controlled) dispatchInternalSelected(action);
    onValueChange?.(next);
    inputRef.current?.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const trigger = (
    <button
      type="button"
      aria-label={label}
      aria-describedby={selectionDescriptionId}
      className={cn(
        'flex h-9 w-full items-center justify-between gap-2 rounded-sm border border-border bg-surface px-2 text-left text-xs text-fg outline-none transition-colors hover:border-border-strong focus-visible:border-signal/60 focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2',
        selectedList.length === 0 && 'text-fg-muted',
        triggerClassName,
      )}
    >
      <span className="truncate">{buttonText}</span>
      <ChevronDown className="size-3.5 shrink-0 text-fg-dim" aria-hidden />
    </button>
  );

  return (
    <label className={cn('min-w-36', className)}>
      <span className="mb-1 block text-xs font-medium text-fg-muted">{label}</span>
      {name ? (
        <input ref={inputRef} type="hidden" name={name} value={selected} form={form} />
      ) : null}
      <span id={selectionDescriptionId} className="sr-only">
        {selectionDescription}
      </span>
      {search ? (
        <SearchableMultiSelect
          trigger={trigger}
          label={label}
          placeholder={placeholder}
          options={normalizedOptions}
          selected={selectedSet}
          search={search}
          onSelect={applySelected}
        />
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto">
            <DropdownMenuItem
              onSelect={() => {
                applySelected({ type: 'clear' });
              }}
              className="text-sm text-fg-muted"
            >
              {placeholder}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {normalizedOptions.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.value}
                checked={selectedSet.has(option.value)}
                onCheckedChange={(checked) => {
                  applySelected({ type: 'checked', value: option.value, checked });
                }}
                onSelect={(event) => {
                  event.preventDefault();
                }}
              >
                <span className="truncate">{option.label}</span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </label>
  );
}

function SearchableMultiSelect({
  trigger,
  label,
  placeholder,
  options,
  selected,
  search,
  onSelect,
}: {
  trigger: ReactNode;
  label: string;
  placeholder: string;
  options: readonly FilterMultiSelectOption[];
  selected: ReadonlySet<string>;
  search: NonNullable<FilterMultiSelectProps['search']>;
  onSelect: (action: SelectedAction) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const optionListRef = useRef<HTMLUListElement>(null);

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        role="dialog"
        aria-label={`${label} filter`}
        className="min-w-56"
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
            value={search.value}
            onChange={(event) => {
              event.stopPropagation();
              search.onValueChange(event.currentTarget.value);
            }}
            onInput={(event) => {
              event.stopPropagation();
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return;
              event.preventDefault();
              focusPickerOption(optionListRef.current, 'first');
            }}
            placeholder={search.placeholder}
            aria-label={search.ariaLabel}
            className="h-9 w-full rounded-sm border border-border bg-bg py-1 pl-8 pr-2 text-base text-fg outline-none placeholder:text-fg-dim focus-visible:border-signal/60 focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2 sm:text-xs"
          />
        </div>
        <div className="-mx-1 my-1 h-px bg-muted" />
        <ul
          ref={optionListRef}
          data-picker-list
          aria-label={`${label} options`}
          className="max-h-72 overflow-y-auto"
        >
          <li className="mb-1 border-b border-muted pb-1">
            <button
              type="button"
              data-picker-option
              aria-pressed={selected.size === 0}
              onClick={() => {
                onSelect({ type: 'clear' });
              }}
              onKeyDown={handlePickerOptionKeyDown}
              className="flex min-h-9 w-full items-center rounded-sm px-2 py-1.5 text-left text-sm text-fg-muted outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-inset forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2"
            >
              {placeholder}
            </button>
          </li>
          {options.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                data-picker-option
                aria-pressed={selected.has(option.value)}
                onClick={() => {
                  onSelect({
                    type: 'checked',
                    value: option.value,
                    checked: !selected.has(option.value),
                  });
                }}
                onKeyDown={handlePickerOptionKeyDown}
                className="flex min-h-9 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-inset forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2"
              >
                <Check
                  className={cn(
                    'size-4 shrink-0',
                    selected.has(option.value) ? 'visible' : 'invisible',
                  )}
                  aria-hidden
                />
                <span className="truncate">{option.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function handlePickerOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const optionList = event.currentTarget.closest<HTMLElement>('[data-picker-list]');
  if (!optionList) return;
  if (event.key === 'Home') focusPickerOption(optionList, 'first');
  else if (event.key === 'End') focusPickerOption(optionList, 'last');
  else
    focusPickerOption(
      optionList,
      event.key === 'ArrowDown' ? 'next' : 'previous',
      event.currentTarget,
    );
}

function focusPickerOption(
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

function selectedReducer(current: string, action: SelectedAction): string {
  if (action.type === 'clear') return '';
  const next = new Set(current.split(',').filter(Boolean));
  if (action.checked) next.add(action.value);
  else next.delete(action.value);
  return Array.from(next).join(',');
}

function optionsWithSelectedValues(
  options: readonly FilterMultiSelectOption[],
  value: string,
): FilterMultiSelectOption[] {
  const seen = new Set(options.map((option) => option.value));
  const selectedOnly: FilterMultiSelectOption[] = [];
  for (const raw of value.split(',')) {
    const part = raw.trim();
    if (!part || seen.has(part)) continue;
    seen.add(part);
    selectedOnly.push({ value: part, label: part });
  }
  return [...options, ...selectedOnly];
}
