'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import styles from '@/components/copy-button.module.css';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { copyAnnouncement } from '@/lib/copy-announcement';
import { cn } from '@/lib/utils';

const COPIED_MS = 1_600;
const copyIconTransition =
  '[grid-area:1/1] motion-safe:transition-[opacity,scale,filter] motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.2,0,0,1)]';

export function CopyButton({
  value,
  label = 'Copy',
  appearance = 'button',
  publicFeedback = false,
  manualCopy = true,
  className,
}: {
  value: string;
  label?: string;
  appearance?: 'button' | 'icon';
  publicFeedback?: boolean;
  manualCopy?: boolean;
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
  const iconOnly = appearance === 'icon';
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

  const button = (
    <Button
      type="button"
      size={iconOnly ? 'icon' : 'sm'}
      variant="ghost"
      aria-label={accessibleLabel}
      className={cn(
        iconOnly &&
          'size-11 shrink-0 text-fg-muted md:size-9 forced-colors:focus-visible:[outline:2px_solid_Highlight]',
        className,
      )}
      onClick={async (event) => {
        const request = ++nextRequest.current;
        setFeedback({ value, request, status: 'idle', pointer: event.detail > 0 });
        const finish = (status: 'copied' | 'error') => {
          setFeedback((current) =>
            current.request === request && current.value === value
              ? { ...current, status }
              : current,
          );
        };
        try {
          const clipboard = Reflect.get(navigator, 'clipboard') as Clipboard | undefined;
          if (!clipboard?.writeText) {
            finish('error');
            return;
          }
          await clipboard.writeText(value);
          finish('copied');
        } catch {
          finish('error');
        }
      }}
    >
      {iconOnly ? (
        <span aria-hidden="true" className="grid">
          <Copy
            className={cn(
              copyIconTransition,
              copied && 'opacity-0 motion-safe:scale-25 motion-safe:blur-[4px]',
            )}
          />
          <Check
            className={cn(
              copyIconTransition,
              !copied && 'opacity-0 motion-safe:scale-25 motion-safe:blur-[4px]',
            )}
          />
        </span>
      ) : (
        <CopyButtonContent
          label={label}
          copied={copied}
          publicFeedback={publicFeedback}
          pointer={Boolean(feedback.pointer)}
          request={feedback.request}
        />
      )}
    </Button>
  );

  return (
    <>
      {iconOnly ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent className="font-sans">{accessibleLabel}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        button
      )}
      <output
        className={
          copyError
            ? 'col-span-full order-last min-w-0 max-w-full basis-full text-xs text-danger [overflow-wrap:anywhere]'
            : 'sr-only'
        }
        aria-live="polite"
      >
        {copyError
          ? manualCopy
            ? 'Could not copy. Try again or select the text and copy it manually.'
            : 'Could not copy. Try again.'
          : copied
            ? copyAnnouncement(label)
            : ''}
      </output>
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
