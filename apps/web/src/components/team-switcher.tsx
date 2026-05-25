'use client';

import { Check, ChevronsUpDown } from 'lucide-react';

import type { TeamMembership } from '@/lib/active-team';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { initials } from '@/lib/initials';
import { cn } from '@/lib/utils';

interface Props {
  active: TeamMembership;
  memberships: TeamMembership[];
  /**
   * - `full` (default): wide button suitable for the mobile sheet.
   * - `rail`: 36px square trigger for the 56px desktop rail.
   */
  variant?: 'full' | 'rail';
}

export function TeamSwitcher({ active, memberships, variant = 'full' }: Props) {
  const monogram = initials(active.teamName);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Switch team — current: ${active.teamName}`}
          className={cn(
            'rounded-sm border border-border bg-surface text-left transition-colors hover:border-border-strong',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
            variant === 'rail'
              ? 'grid size-9 place-items-center font-mono text-[11px] font-semibold uppercase tracking-wider text-fg'
              : 'flex w-full items-center gap-3 px-3 py-2 text-sm hover:bg-surface-2',
          )}
          title={variant === 'rail' ? `Team · ${active.teamName}` : undefined}
        >
          {variant === 'rail' ? (
            <span aria-hidden="true">{monogram}</span>
          ) : (
            <>
              <span className="grid size-7 shrink-0 place-items-center rounded-sm border border-border bg-bg font-mono text-[11px] font-semibold text-fg">
                {monogram}
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-sm font-medium text-fg">
                  {active.teamName}
                </span>
                <span className="truncate font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                  Active team
                </span>
              </span>
              <ChevronsUpDown
                aria-hidden="true"
                className="size-3.5 shrink-0 text-fg-dim"
              />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={variant === 'rail' ? 'start' : 'start'}
        side={variant === 'rail' ? 'right' : 'top'}
        className="w-64"
      >
        <DropdownMenuLabel className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
          Switch team
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map((m) => (
          <form
            key={m.teamId}
            action={`/app/team/switch/${m.teamId}`}
            method="post"
          >
            <DropdownMenuItem asChild>
              <button
                type="submit"
                className="flex w-full items-center justify-between"
              >
                <span className="truncate">{m.teamName}</span>
                {m.teamId === active.teamId ? (
                  <Check className="size-4 text-signal" />
                ) : null}
              </button>
            </DropdownMenuItem>
          </form>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
