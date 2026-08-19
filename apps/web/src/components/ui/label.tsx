'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const labelVariants = cva(
  'font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
  {
    variants: {
      size: {
        default: 'text-sm text-fg',
        sm: 'text-xs text-fg-muted',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

type LabelProps = React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
  VariantProps<typeof labelVariants> & {
    ref?: React.Ref<React.ElementRef<typeof LabelPrimitive.Root>>;
  };

function Label({ className, size, ref, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root ref={ref} className={cn(labelVariants({ size }), className)} {...props} />
  );
}
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
