import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';

import { cn } from '@/lib/utils';

type DivProps = React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>;
};

function Card({ className, ref, ...props }: DivProps) {
  return (
    <div
      ref={ref}
      className={cn(
        'min-w-0 rounded-lg border border-border bg-card text-card-foreground',
        className,
      )}
      {...props}
    />
  );
}
Card.displayName = 'Card';

function CardHeader({ className, ref, ...props }: DivProps) {
  return <div ref={ref} className={cn('flex flex-col space-y-1.5 p-4', className)} {...props} />;
}
CardHeader.displayName = 'CardHeader';

type CardTitleProps = DivProps & {
  as?: 'div' | 'h2' | 'h3';
  asChild?: boolean;
};

function CardTitle({ className, ref, as = 'div', asChild = false, ...props }: CardTitleProps) {
  const Comp = asChild ? Slot : as;
  return (
    <Comp
      ref={ref}
      className={cn('text-base font-semibold leading-tight tracking-tight', className)}
      {...props}
    />
  );
}
CardTitle.displayName = 'CardTitle';

function CardDescription({ className, ref, ...props }: DivProps) {
  return <div ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
CardDescription.displayName = 'CardDescription';

function CardContent({ className, ref, ...props }: DivProps) {
  return <div ref={ref} className={cn('min-w-0 p-4 pt-0', className)} {...props} />;
}
CardContent.displayName = 'CardContent';

function CardFooter({ className, ref, ...props }: DivProps) {
  return <div ref={ref} className={cn('flex items-center p-4 pt-0', className)} {...props} />;
}
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
