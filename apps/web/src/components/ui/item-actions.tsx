'use client';

import { MoreHorizontal } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export function ItemActionGroup({
  label,
  placement = 'row',
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<'fieldset'> & {
  label: string;
  placement?: 'row' | 'footer';
}) {
  return (
    <fieldset
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-2',
        placement === 'row' && 'w-full justify-start sm:w-auto sm:shrink-0 sm:justify-end',
        placement === 'footer' &&
          'mt-3 min-h-9 justify-start border-t border-border pt-2 sm:justify-end',
        className,
      )}
      {...props}
    >
      <legend className="sr-only">{label}</legend>
      {children}
    </fieldset>
  );
}

export function ItemOverflowMenu({
  targetLabel,
  children,
  align = 'end',
  triggerClassName,
  contentClassName,
}: {
  targetLabel: string;
  children: ReactNode;
  align?: ComponentPropsWithoutRef<typeof DropdownMenuContent>['align'];
  triggerClassName?: string;
  contentClassName?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn('size-8 shrink-0 text-fg-dim', triggerClassName)}
          aria-label={`Actions for ${targetLabel}`}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={contentClassName}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
