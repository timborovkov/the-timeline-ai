import * as React from 'react';

import { cn } from '@/lib/utils';

type SeparatorProps = React.HTMLAttributes<HTMLHRElement> & {
  orientation?: 'horizontal' | 'vertical';
  ref?: React.Ref<HTMLHRElement>;
};

function Separator({ className, orientation = 'horizontal', ref, ...props }: SeparatorProps) {
  return (
    <hr
      ref={ref}
      aria-orientation={orientation}
      className={cn(
        'shrink-0 border-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}
Separator.displayName = 'Separator';

export { Separator };
