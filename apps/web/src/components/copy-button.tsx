'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { copyAnnouncement } from '@/lib/copy-announcement';
import { cn } from '@/lib/utils';

const COPIED_MS = 1_600;

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
  const nextRequest = useRef(0);
  const [feedback, setFeedback] = useState<{
    value: string;
    request: number;
    status: 'idle' | 'copied' | 'error';
  }>({ value, request: 0, status: 'idle' });
  if (feedback.value !== value) {
    setFeedback({ value, request: 0, status: 'idle' });
  }
  const copied = feedback.status === 'copied';
  const copyError = feedback.status === 'error';
  const accessibleLabel = label.toLowerCase().startsWith('copy') ? label : `Copy ${label}`;

  useEffect(() => {
    if (feedback.status !== 'copied') return;
    const timer = window.setTimeout(() => {
      setFeedback((current) => (current === feedback ? { ...current, status: 'idle' } : current));
    }, COPIED_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [feedback]);

  return (
    <>
      <Button
        type="button"
        size={appearance === 'icon' ? 'sm' : 'sm'}
        variant="ghost"
        aria-label={accessibleLabel}
        className={cn(appearance === 'icon' && 'h-7 shrink-0 px-2', className)}
        onClick={() => {
          const request = ++nextRequest.current;
          setFeedback({ value, request, status: 'idle' });
          const finish = (status: 'copied' | 'error') => {
            setFeedback((current) =>
              current.request === request && current.value === value
                ? { ...current, status }
                : current,
            );
          };
          const clipboard = Reflect.get(navigator, 'clipboard') as Clipboard | undefined;
          if (!clipboard?.writeText) {
            finish('error');
            return;
          }
          void clipboard
            .writeText(value)
            .then(() => {
              finish('copied');
            })
            .catch(() => {
              finish('error');
            });
        }}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {appearance === 'icon' ? (copied ? 'Copied' : 'Copy') : copied ? 'Copied' : label}
      </Button>
      {copyError ? (
        <output
          className="order-last min-w-0 max-w-full basis-full text-xs text-danger [overflow-wrap:anywhere]"
          aria-live="polite"
        >
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
