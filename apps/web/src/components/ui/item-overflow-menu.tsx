import { MoreHorizontal } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export function ItemOverflowMenu({
  targetLabel,
  children,
  align = 'end',
  triggerClassName,
  contentClassName,
  triggerRef,
}: {
  targetLabel: string;
  children: ReactNode;
  align?: ComponentPropsWithoutRef<typeof DropdownMenuContent>['align'];
  triggerClassName?: string;
  contentClassName?: string;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
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
