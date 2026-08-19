import Link from 'next/link';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const ACTION_FOCUS_CLASS =
  'focus-visible:ring-border-strong focus-visible:ring-offset-bg forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2';

export function EmptyState({
  icon: Icon,
  title,
  body,
  href,
  action,
  actionVariant = 'outline',
  size = 'page',
  children,
  className,
  titleId,
}: {
  icon?: LucideIcon;
  title: string;
  body: string;
  href?: string;
  action?: string;
  actionVariant?: 'outline' | 'primary';
  size?: 'page' | 'inset' | 'compact';
  children?: ReactNode;
  className?: string;
  titleId?: string;
}) {
  const actionControl =
    href && action ? (
      <Button
        asChild
        size="sm"
        variant={actionVariant === 'primary' ? 'default' : 'outline'}
        className={ACTION_FOCUS_CLASS}
      >
        <Link href={href}>{action}</Link>
      </Button>
    ) : null;

  return (
    <output
      className={cn(
        'block text-center not-italic',
        size === 'page' && 'border-y border-border px-4 py-16',
        size === 'inset' && 'px-4 py-10',
        size === 'compact' && 'px-3 py-8',
        className,
      )}
    >
      {Icon ? (
        <Icon
          aria-hidden="true"
          strokeWidth={1.5}
          className={cn('mx-auto text-fg-dim', size === 'compact' ? 'size-5' : 'size-7')}
        />
      ) : null}
      <p id={titleId} className={cn('text-sm font-semibold text-fg', Icon ? 'mt-3' : null)}>
        {title}
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-fg-muted">{body}</p>
      {actionControl || children ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {actionControl}
          {children}
        </div>
      ) : null}
    </output>
  );
}
