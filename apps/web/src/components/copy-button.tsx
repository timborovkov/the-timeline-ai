'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 1600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          const clipboard = Reflect.get(navigator, 'clipboard') as Clipboard | undefined;
          if (!clipboard?.writeText) {
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
              setCopyError(true);
            });
        }}
      >
        {copied ? 'Copied' : label}
      </Button>
      {copyError ? (
        <output className="text-xs text-destructive" aria-live="polite">
          Could not copy. Try again or select the text and copy it manually.
        </output>
      ) : (
        <output className="sr-only" aria-live="polite">
          {copied ? `${label} copied.` : ''}
        </output>
      )}
    </>
  );
}
