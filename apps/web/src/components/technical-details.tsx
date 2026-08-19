'use client';

import { type ReactNode } from 'react';

import { CopyButton } from '@/components/copy-button';
import { cn } from '@/lib/utils';

interface TechnicalDetailItem {
  id?: string;
  label: string;
  value: ReactNode;
  copyValue?: string;
}

interface TechnicalDetailsProps {
  items?: TechnicalDetailItem[];
  children?: ReactNode;
  summary?: string;
  className?: string;
  compact?: boolean;
}

const EMPTY_ITEMS: TechnicalDetailItem[] = [];

export function TechnicalDetails({
  items = EMPTY_ITEMS,
  children,
  summary = 'Technical details',
  className,
  compact = false,
}: TechnicalDetailsProps) {
  return (
    <details
      className={cn(
        'group',
        compact ? 'border-0 pt-1 text-xs' : 'border-t border-border pt-3 text-sm',
        className,
      )}
    >
      <summary
        className={cn(
          'cursor-pointer list-none marker:hidden hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50',
          compact
            ? 'text-xs font-normal text-fg-dim'
            : 'text-sm font-medium text-fg-muted focus-visible:ring-offset-2',
        )}
      >
        <span aria-hidden="true" className="mr-2 inline-block text-fg-dim group-open:rotate-90">
          ›
        </span>
        {summary}
      </summary>
      <div className={compact ? 'mt-1.5 space-y-1.5' : 'mt-3 space-y-3'}>
        {items.length > 0 ? (
          <dl className="grid gap-3 sm:grid-cols-[minmax(8rem,0.35fr)_minmax(0,1fr)]">
            {items.map((item) => {
              const itemCopyValue = item.copyValue;
              const itemKey = item.id ?? itemCopyValue ?? item.label;
              return (
                <div key={itemKey} className="contents">
                  <dt className="text-xs text-fg-muted">{item.label}</dt>
                  <dd className="m-0 flex min-w-0 items-start gap-2">
                    <code className="min-w-0 flex-1 break-all text-xs text-fg">{item.value}</code>
                    {itemCopyValue ? (
                      <CopyButton value={itemCopyValue} label={item.label} appearance="icon" />
                    ) : null}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : null}
        {children}
      </div>
    </details>
  );
}
