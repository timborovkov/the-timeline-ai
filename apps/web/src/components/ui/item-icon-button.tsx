import type { ComponentPropsWithoutRef } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function ItemIconButton({
  label,
  className,
  variant = 'ghost',
  ...props
}: Omit<ComponentPropsWithoutRef<typeof Button>, 'size' | 'variant'> & {
  label: string;
  variant?: ComponentPropsWithoutRef<typeof Button>['variant'];
}) {
  return (
    <Button
      type="button"
      variant={variant}
      size="icon"
      aria-label={label}
      title={label}
      className={cn('size-8 shrink-0 text-fg-dim hover:bg-surface-2 hover:text-fg', className)}
      {...props}
    />
  );
}
