'use client';

import { Check, CheckCircle2, RotateCcw, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, type RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useOnboardingChecklistQuery } from '@/lib/use-paginated-queries';

export function OnboardingChecklist() {
  const {
    data,
    isPending,
    checklistLoadFailed,
    retryChecklist,
    mutateChecklist,
    checklistPending,
    checklistMutationFailed,
    retryChecklistMutation,
  } = useOnboardingChecklistQuery();
  const dismissButtonRef = useRef<HTMLButtonElement>(null);
  const reopenButtonRef = useRef<HTMLButtonElement>(null);
  const nextActionRef = useRef<HTMLButtonElement>(null);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const lastMutationKind = useRef<'dismiss' | 'reopen' | 'complete' | null>(null);
  const pendingFocusTarget = useRef<'dismiss' | 'reopen' | 'next-action' | null>(null);

  useEffect(() => {
    const target = pendingFocusTarget.current;
    if (!target || checklistPending || !data) return;

    if (document.activeElement && document.activeElement !== document.body) {
      pendingFocusTarget.current = null;
      return;
    }

    if (target === 'next-action') {
      if (checklistMutationFailed) {
        retryButtonRef.current?.focus();
      } else if (nextActionRef.current) {
        nextActionRef.current.focus();
      } else {
        dismissButtonRef.current?.focus();
      }
      pendingFocusTarget.current = null;
      return;
    }

    const expectedDismissed = target === 'reopen';
    const mutationSettled = data.dismissed === expectedDismissed || checklistMutationFailed;
    if (!mutationSettled) return;

    if (data.dismissed) {
      reopenButtonRef.current?.focus();
    } else {
      dismissButtonRef.current?.focus();
    }
    pendingFocusTarget.current = null;
  }, [checklistMutationFailed, checklistPending, data]);
  const updateStatus = (
    <output aria-live="polite" aria-atomic="true" className="sr-only">
      {checklistPending ? 'Updating setup…' : ''}
    </output>
  );

  if (isPending) {
    return (
      <>
        {updateStatus}
        <section
          aria-busy="true"
          aria-label="Loading next setup step"
          className="border-y border-border py-4"
        >
          <Skeleton className="h-5 w-32 motion-reduce:animate-none" />
          <div className="mt-3 flex items-start gap-3">
            <Skeleton className="size-5 rounded-full motion-reduce:animate-none" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48 motion-reduce:animate-none" />
              <Skeleton className="h-3 w-full max-w-lg motion-reduce:animate-none" />
            </div>
          </div>
        </section>
      </>
    );
  }
  if (checklistLoadFailed && !data) {
    return (
      <>
        {updateStatus}
        <section aria-labelledby="onboarding-heading" className="border-y border-border py-4">
          <h2 id="onboarding-heading" className="text-base font-semibold text-fg">
            Next setup step
          </h2>
          <p role="alert" className="mt-2 text-sm text-danger">
            Unable to load setup. Check your connection and try again.
          </p>
          <Button
            type="button"
            onClick={() => {
              void retryChecklist();
            }}
            variant="outline"
            className="mt-3"
          >
            Retry
          </Button>
        </section>
      </>
    );
  }
  if (!data) return null;
  const retryMutation = () => {
    pendingFocusTarget.current =
      lastMutationKind.current === 'complete'
        ? 'next-action'
        : data.dismissed
          ? 'dismiss'
          : 'reopen';
    retryChecklistMutation();
  };

  if (data.dismissed) {
    return (
      <>
        {updateStatus}
        <div className="space-y-3">
          <Button
            ref={reopenButtonRef}
            type="button"
            disabled={checklistPending}
            onClick={() => {
              lastMutationKind.current = 'reopen';
              pendingFocusTarget.current = 'dismiss';
              mutateChecklist({ action: 'reopen' });
            }}
            variant="outline"
            size="sm"
          >
            <RotateCcw className="size-3" />
            Reopen setup
          </Button>
          <ChecklistMutationFailure
            failed={checklistMutationFailed}
            pending={checklistPending}
            onRetry={retryMutation}
            retryButtonRef={retryButtonRef}
          />
        </div>
      </>
    );
  }
  const completedCount = data.items.filter((item) => item.completed).length;
  const nextItem = data.items.find((item) => !item.completed);
  const nextItemMeta = nextItem ? onboardingMeta(nextItem.key) : null;

  return (
    <>
      {updateStatus}
      <section aria-labelledby="onboarding-heading" className="border-y border-border py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 id="onboarding-heading" className="text-base font-semibold text-fg">
                Next setup step
              </h2>
              <span
                aria-label={`${completedCount} of ${data.items.length} setup steps complete`}
                className="font-mono text-xs text-fg-dim"
              >
                {completedCount}/{data.items.length}
              </span>
            </div>
            {nextItem ? (
              <div className="mt-3 flex items-start gap-3">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-border font-mono text-[10px] text-fg-muted">
                  {completedCount + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-fg">{nextItem.label}</span>
                  <span className="mt-0.5 block text-xs text-fg-muted">
                    {nextItemMeta?.description}
                  </span>
                </span>
              </div>
            ) : (
              <p className="mt-3 flex items-center gap-2 text-sm text-fg-muted">
                <CheckCircle2 aria-hidden="true" className="size-4 text-signal" />
                Setup is complete
              </p>
            )}
          </div>
          <Button
            ref={dismissButtonRef}
            type="button"
            disabled={checklistPending}
            onClick={() => {
              lastMutationKind.current = 'dismiss';
              pendingFocusTarget.current = 'reopen';
              mutateChecklist({ action: 'dismiss' });
            }}
            aria-label="Dismiss setup"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-fg-muted"
          >
            <X aria-hidden="true" className="size-3.5" />
            Dismiss
          </Button>
        </div>
        {nextItem && nextItemMeta ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {nextItem.key === 'first_note' ? (
              <Button
                type="button"
                onClick={() => {
                  window.location.hash = 'capture';
                }}
                variant="outline"
                size="sm"
              >
                {nextItemMeta.cta}
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link href={nextItemMeta.href}>{nextItemMeta.cta}</Link>
              </Button>
            )}
            <Button
              ref={nextActionRef}
              type="button"
              disabled={checklistPending}
              onClick={() => {
                lastMutationKind.current = 'complete';
                pendingFocusTarget.current = 'next-action';
                mutateChecklist({ action: 'complete', key: nextItem.key });
              }}
              aria-label={`Mark ${nextItem.label} complete`}
              variant="ghost"
              size="sm"
              className="gap-1.5 px-2 text-fg-muted"
            >
              <Check className="size-3.5" />
              Mark complete
            </Button>
          </div>
        ) : null}
        <ChecklistMutationFailure
          failed={checklistMutationFailed}
          pending={checklistPending}
          onRetry={retryMutation}
          retryButtonRef={retryButtonRef}
        />
      </section>
    </>
  );
}

function ChecklistMutationFailure({
  failed,
  pending,
  onRetry,
  retryButtonRef,
}: {
  failed: boolean;
  pending: boolean;
  onRetry: () => void;
  retryButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  if (!failed) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <p role="alert" className="text-xs text-danger">
        Unable to update setup. Your previous setup state was restored.
      </p>
      <Button
        ref={retryButtonRef}
        type="button"
        disabled={pending}
        onClick={onRetry}
        variant="outline"
        size="sm"
      >
        Retry update
      </Button>
    </div>
  );
}

function onboardingMeta(key: string): { href: string; cta: string; description: string } {
  switch (key) {
    case 'first_note':
      return {
        href: '/app#capture',
        cta: 'Capture',
        description: 'Save one note, decision, or follow-up into the team log.',
      };
    case 'telegram':
      return {
        href: '/app/team/telegram',
        cta: 'Link',
        description: 'Let chats and voice notes flow into the timeline.',
      };
    case 'slack':
      return {
        href: '/app/team/slack',
        cta: 'Install',
        description: 'Bind Slack conversations and user identity.',
      };
    case 'email_forwarding':
      return {
        href: '/app/sources',
        cta: 'Open connections',
        description: 'Forward an email into the archive.',
      };
    case 'first_document':
      return {
        href: '/app/documents',
        cta: 'Upload',
        description: 'Add a document the agent can search and cite.',
      };
    case 'first_integration':
      return {
        href: '/app/sources',
        cta: 'Connect',
        description: 'Wire in external systems or an MCP server.',
      };
    default:
      return {
        href: '/app',
        cta: 'Open',
        description: 'Complete this setup step when ready.',
      };
  }
}
