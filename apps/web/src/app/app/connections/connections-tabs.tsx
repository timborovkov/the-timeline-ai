'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';

import type { ConnectionsTab } from '@/app/app/connections/connection-directory';
import type { KeyboardEvent } from 'react';

import { CONNECTIONS_TABS, connectionsTabHref } from '@/app/app/connections/connection-directory';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const TAB_LABEL: Record<ConnectionsTab, string> = {
  sources: 'Sources',
  agent: 'Agent tools',
  developer: 'Developer',
};

const CONNECTIONS_SEARCH_LABEL: Record<ConnectionsTab, string | null> = {
  sources: 'Search sources',
  agent: 'Search agent tools',
  developer: null,
};

function tabClass(active: boolean): string {
  return cn(
    'inline-flex shrink-0 cursor-pointer items-center whitespace-nowrap rounded-t-sm px-2.5 py-2 text-sm no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 sm:px-3',
    active
      ? '-mb-px border-b-2 border-signal font-medium text-fg'
      : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
  );
}

function ConnectionsSearch({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <label className="relative mb-1.5 flex w-full min-w-40 max-w-none items-center sm:w-56 sm:max-w-56">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 size-3.5 text-fg-dim"
      />
      <Input
        type="search"
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        placeholder="Search"
        aria-label={label}
        className="h-8 border-border bg-bg pl-8 text-sm shadow-none"
      />
    </label>
  );
}

export function ConnectionsTabs({
  tab,
  onChange,
  query,
  onQueryChange,
}: {
  tab: ConnectionsTab;
  onChange: (tab: ConnectionsTab) => void;
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const searchLabel = CONNECTIONS_SEARCH_LABEL[tab];

  function activate(next: ConnectionsTab) {
    const target = document.getElementById(`connections-tab-${next}`);
    target?.focus();
    target?.click();
  }

  function onKeyDown(event: KeyboardEvent<HTMLAnchorElement>, current: ConnectionsTab) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      const index = CONNECTIONS_TABS.indexOf(current);
      activate(
        CONNECTIONS_TABS[(index + 1 + CONNECTIONS_TABS.length) % CONNECTIONS_TABS.length] ??
          current,
      );
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const index = CONNECTIONS_TABS.indexOf(current);
      activate(
        CONNECTIONS_TABS[(index - 1 + CONNECTIONS_TABS.length) % CONNECTIONS_TABS.length] ??
          current,
      );
    } else if (event.key === 'Home') {
      event.preventDefault();
      activate('sources');
    } else if (event.key === 'End') {
      event.preventDefault();
      activate('developer');
    }
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border sm:flex-row sm:items-end sm:justify-between sm:gap-3">
      <div
        role="tablist"
        aria-label="Connections sections"
        className="flex min-w-0 gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {CONNECTIONS_TABS.map((item) => {
          const selected = tab === item;
          return (
            <Link
              key={item}
              href={connectionsTabHref(item)}
              replace
              scroll={false}
              role="tab"
              id={`connections-tab-${item}`}
              aria-selected={selected}
              aria-controls={`connections-panel-${item}`}
              tabIndex={selected ? 0 : -1}
              className={tabClass(selected)}
              onClick={() => {
                onChange(item);
              }}
              onKeyDown={(event) => {
                onKeyDown(event, item);
              }}
            >
              {TAB_LABEL[item]}
            </Link>
          );
        })}
      </div>
      {searchLabel ? (
        <ConnectionsSearch value={query} onChange={onQueryChange} label={searchLabel} />
      ) : null}
    </div>
  );
}
