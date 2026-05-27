'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

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
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={() => {
        if (!('clipboard' in navigator)) return;
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
          })
          .catch(() => undefined);
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}
