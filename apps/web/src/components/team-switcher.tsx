'use client';

import { Check, ChevronsUpDown } from 'lucide-react';

import type { TeamMembership } from '@/lib/active-team';

import { Button } from '@/components/ui/button';
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

export function TeamSwitcher({ active, memberships }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <span className="max-w-40 truncate">{active.teamName}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
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
