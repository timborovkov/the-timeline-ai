import { cn } from '@/lib/utils';

type SkeletonProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'aria-hidden' | 'children' | 'contentEditable' | 'dangerouslySetInnerHTML' | 'tabIndex'
>;

function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={cn(
        'animate-pulse motion-reduce:animate-none rounded-md bg-muted/70 dark:bg-muted/40',
        className,
      )}
    />
  );
}

export { Skeleton };
