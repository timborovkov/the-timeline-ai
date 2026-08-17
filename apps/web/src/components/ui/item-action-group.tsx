import type { ComponentPropsWithoutRef } from 'react';

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
