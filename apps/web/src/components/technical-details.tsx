'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

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
  const [copied, setCopied] = useState<string | null>(null);
  const [copyAnnouncement, setCopyAnnouncement] = useState('');
  const [copyError, setCopyError] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => {
      setCopied(null);
      setCopyAnnouncement('');
    }, 1500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  async function copyTechnicalValue(value: string, itemKey: string, itemLabel: string) {
    setCopied(null);
    setCopyAnnouncement('');
    setCopyError(false);
    const clipboard = Reflect.get(navigator, 'clipboard') as Clipboard | undefined;
    if (!clipboard?.writeText) {
      setCopyError(true);
      return;
    }
    try {
      await clipboard.writeText(value);
    } catch {
      setCopyError(true);
      return;
    }
    setCopied(itemKey);
    setCopyAnnouncement(`Copied ${itemLabel}.`);
  }

  return (
    <>
      <details
        className={cn(
          'group',
          compact
            ? 'border-0 pt-1 text-xs'
            : 'border-t border-border pt-3 text-sm',
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 shrink-0 px-2"
                          onClick={() =>
                            void copyTechnicalValue(itemCopyValue, itemKey, item.label)
                          }
                          aria-label={`Copy ${item.label}`}
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
      <output
        aria-live="polite"
        aria-atomic="true"
        className={copyError ? 'mt-2 block text-xs text-danger' : 'sr-only'}
      >
        {copyError
          ? 'Could not copy. Try again or select the text and copy it manually.'
          : copyAnnouncement}
      </output>
    </>
  );
}
