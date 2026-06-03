import * as React from 'react';

import { cn } from '@/lib/utils';

type SeparatorProps = React.HTMLAttributes<HTMLDivElement> & {
  orientation?: 'horizontal' | 'vertical';
  ref?: React.Ref<HTMLDivElement>;
};

function Separator({ className, orientation = 'horizontal', ref, ...props }: SeparatorProps) {
  return (
    <div
      ref={ref}
      role="separator"
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}
Separator.displayName = 'Separator';

export { Separator };
