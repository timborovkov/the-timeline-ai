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

interface Props {
  active: TeamMembership;
  memberships: TeamMembership[];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function TeamSwitcher({ active, memberships }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-md border border-border/70 bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-accent/60"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/12 text-[11px] font-semibold tracking-tight text-primary">
            {initials(active.teamName)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-sm font-medium">{active.teamName}</span>
            <span className="truncate text-[11px] text-muted-foreground">Active team</span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-64">
        <DropdownMenuLabel>Switch team</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map((m) => (
          <form key={m.teamId} action={`/app/team/switch/${m.teamId}`} method="post">
            <DropdownMenuItem asChild>
              <button type="submit" className="flex w-full items-center justify-between">
                <span className="truncate">{m.teamName}</span>
                {m.teamId === active.teamId ? <Check className="h-4 w-4" /> : null}
              </button>
            </DropdownMenuItem>
          </form>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
