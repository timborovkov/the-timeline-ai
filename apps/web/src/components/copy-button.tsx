'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const COPIED_MS = 1_600;

export function copyAnnouncement(label: string): string {
  const noun = label.replace(/^Copy\s+/iu, '').trim();
  return noun && noun.toLowerCase() !== 'copy' ? `Copied ${noun}.` : 'Copied.';
}

export function CopyButton({
  value,
  label = 'Copy',
  appearance = 'button',
  className,
}: {
  value: string;
  label?: string;
  appearance?: 'button' | 'icon';
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const accessibleLabel = label.toLowerCase().startsWith('copy') ? label : `Copy ${label}`;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, COPIED_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  return (
    <>
      <Button
        type="button"
        size={appearance === 'icon' ? 'sm' : 'sm'}
        variant="ghost"
        aria-label={accessibleLabel}
        className={cn(appearance === 'icon' && 'h-7 shrink-0 px-2', className)}
        onClick={() => {
          const clipboard = Reflect.get(navigator, 'clipboard') as Clipboard | undefined;
          if (!clipboard?.writeText) {
            setCopied(false);
            setCopyError(true);
            return;
          }
          setCopyError(false);
          void clipboard
            .writeText(value)
            .then(() => {
              setCopied(true);
            })
            .catch(() => {
              setCopied(false);
              setCopyError(true);
            });
        }}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {appearance === 'icon' ? (copied ? 'Copied' : 'Copy') : copied ? 'Copied' : label}
      </Button>
      {copyError ? (
        <output className="text-xs text-danger" aria-live="polite">
          Could not copy. Try again or select the text and copy it manually.
        </output>
      ) : (
        <output className="sr-only" aria-live="polite">
          {copied ? copyAnnouncement(label) : ''}
        </output>
      )}
    </>
  );
}
