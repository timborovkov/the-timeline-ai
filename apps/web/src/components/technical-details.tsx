'use client';

import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
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
}

const EMPTY_ITEMS: TechnicalDetailItem[] = [];

export function TechnicalDetails({
  items = EMPTY_ITEMS,
  children,
  summary = 'Technical details',
  className,
}: TechnicalDetailsProps) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copyTechnicalValue(value: string, itemKey: string) {
    await navigator.clipboard.writeText(value);
    setCopied(itemKey);
    window.setTimeout(() => {
      setCopied((current) => (current === itemKey ? null : current));
    }, 1500);
  }

  return (
    <details className={cn('group border-t border-border pt-3 text-sm', className)}>
      <summary className="cursor-pointer list-none text-sm font-medium text-fg-muted marker:hidden hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <span aria-hidden="true" className="mr-2 inline-block text-fg-dim group-open:rotate-90">
          ›
        </span>
        {summary}
      </summary>
      <div className="mt-3 space-y-3">
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 px-2"
                        onClick={() => void copyTechnicalValue(itemCopyValue, itemKey)}
                        aria-label={`Copy ${typeof item.label === 'string' ? item.label : 'technical value'}`}
                      >
                        {copied === itemKey ? (
                          <Check aria-hidden="true" />
                        ) : (
                          <Copy aria-hidden="true" />
                        )}
                        {copied === itemKey ? 'Copied' : 'Copy'}
                      </Button>
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
