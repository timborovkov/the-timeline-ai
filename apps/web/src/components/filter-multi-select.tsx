'use client';

import { ChevronDown } from 'lucide-react';
import { useMemo, useReducer } from 'react';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
}: FilterMultiSelectProps) {
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
  const buttonText =
    selectedList.length === 0
      ? placeholder
      : selectedList.length === 1
        ? (optionLabel.get(selectedList[0] ?? '') ?? selectedList[0])
        : `${selectedList.length} selected`;

  function applySelected(action: SelectedAction): void {
    const next = selectedReducer(selected, action);
    if (!controlled) dispatchInternalSelected(action);
    onValueChange?.(next);
  }

  return (
    <label className={cn('min-w-36', className)}>
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
        {label}
      </span>
      {name ? <input type="hidden" name={name} value={selected} /> : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn(
              'flex h-9 w-full items-center justify-between gap-2 rounded-sm border border-border bg-surface px-2 text-left text-xs text-fg outline-none transition-colors hover:border-border-strong focus-visible:border-signal/60 focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              selectedList.length === 0 && 'text-fg-muted',
              triggerClassName,
            )}
          >
            <span className="truncate">{buttonText}</span>
            <ChevronDown className="size-3.5 shrink-0 text-fg-dim" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto">
          <DropdownMenuItem
            onSelect={() => {
              applySelected({ type: 'clear' });
            }}
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted"
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
    </label>
  );
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
