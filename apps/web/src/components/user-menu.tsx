'use client';

import { LifeBuoy, LogOut, MailWarning, User } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useActionState } from 'react';

import { resendEmailVerificationAction, type EmailVerificationState } from '@/app/actions/auth';
import { reopenOnboardingChecklistAction } from '@/app/actions/onboarding';
import { FormActionToast } from '@/components/form-action-toast';
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
  user: { name?: string | null; email?: string | null; emailVerified?: Date | string | null };
}

export function UserMenu({ user }: Props) {
  const [verificationState, resendVerification] = useActionState<EmailVerificationState, FormData>(
    resendEmailVerificationAction,
    {},
  );
  const isUnverified = Boolean(user.email && !user.emailVerified);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account" className="relative">
          <User className="size-4" />
          {isUnverified ? (
            <span className="absolute right-1 top-1 size-1.5 rounded-full bg-signal" />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{user.name ?? 'Account'}</span>
            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
            {isUnverified ? (
              <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-sm border border-signal/40 px-1.5 py-0.5 text-[11px] uppercase tracking-[0.12em] text-signal">
                <MailWarning className="size-3" />
                Unverified
              </span>
            ) : null}
          </div>
        </DropdownMenuLabel>
        {isUnverified ? (
          <>
            <DropdownMenuSeparator />
            <form action={resendVerification}>
              <FormActionToast
                id="account:resend-verification"
                error={verificationState.error}
                success={verificationState.ok ? 'Verification email sent' : undefined}
                loading="Sending verification email…"
              />
              <DropdownMenuItem asChild>
                <button type="submit" className="flex w-full items-center gap-2">
                  <MailWarning className="size-4" />
                  Resend verification
                </button>
              </DropdownMenuItem>
            </form>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <form action={reopenOnboardingChecklistAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="flex w-full items-center gap-2">
              <LifeBuoy className="size-4" />
              Team setup checklist
            </button>
          </DropdownMenuItem>
        </form>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <button
            type="button"
            onClick={() => {
              void signOut({ redirect: false, redirectTo: '/sign-in' }).then(() => {
                window.location.assign('/sign-in');
              });
            }}
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
