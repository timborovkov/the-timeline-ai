'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import styles from '@/components/copy-button.module.css';
import { Button } from '@/components/ui/button';
import { copyAnnouncement } from '@/lib/copy-announcement';
import { cn } from '@/lib/utils';

const COPIED_MS = 1_600;

export function CopyButton({
  value,
  label = 'Copy',
  appearance = 'button',
  publicFeedback = false,
  className,
}: {
  value: string;
  label?: string;
  appearance?: 'button' | 'icon';
  publicFeedback?: boolean;
  className?: string;
}) {
  const nextRequest = useRef(0);
  const [feedback, setFeedback] = useState<{
    value: string;
    request: number;
    status: 'idle' | 'copied' | 'error';
    pointer?: boolean;
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
        size="sm"
        variant="ghost"
        aria-label={accessibleLabel}
        className={cn(appearance === 'icon' && 'h-7 shrink-0 px-2', className)}
        onClick={(event) => {
          const request = ++nextRequest.current;
          setFeedback({ value, request, status: 'idle', pointer: event.detail > 0 });
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
        <CopyButtonContent
          label={appearance === 'icon' ? 'Copy' : label}
          copied={copied}
          publicFeedback={publicFeedback}
          pointer={Boolean(feedback.pointer)}
          request={feedback.request}
        />
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

function CopyButtonContent({
  label,
  copied,
  publicFeedback,
  pointer,
  request,
}: {
  label: string;
  copied: boolean;
  publicFeedback: boolean;
  pointer: boolean;
  request: number;
}) {
  const Icon = copied ? Check : Copy;
  const visibleLabel = copied ? 'Copied' : label;
  if (!publicFeedback) {
    return (
      <>
        <Icon aria-hidden="true" />
        {visibleLabel}
      </>
    );
  }
  return (
    <span
      key={`${request}-${copied}`}
      className={cn(styles.content, copied && pointer && styles.confirmed)}
      aria-hidden="true"
    >
      <Icon />
      <span className={styles.label}>
        <span className={styles.reserve}>{label}</span>
        <span className={styles.reserve}>Copied</span>
        <span>{visibleLabel}</span>
      </span>
    </span>
  );
}
