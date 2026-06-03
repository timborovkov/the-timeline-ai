'use client';

import { LifeBuoy, LogOut, User } from 'lucide-react';
import { signOut } from 'next-auth/react';

import { reopenOnboardingChecklistAction } from '@/app/actions/onboarding';
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
  user: { name?: string | null; email?: string | null };
}

export function UserMenu({ user }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account">
          <User className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{user.name ?? 'Account'}</span>
            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <form action={reopenOnboardingChecklistAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="flex w-full items-center gap-2">
              <LifeBuoy className="size-4" />
              Setup checklist
            </button>
          </DropdownMenuItem>
        </form>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <button
            type="button"
            onClick={() => void signOut({ redirectTo: '/sign-in' })}
            className="flex w-full items-center gap-2"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
