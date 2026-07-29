'use client';

import { Check, CheckCircle2, RotateCcw, X } from 'lucide-react';
import Link from 'next/link';

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
  if (isPending) {
    return (
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
    );
  }
  if (checklistLoadFailed && !data) {
    return (
      <section aria-labelledby="onboarding-heading" className="border-y border-border py-4">
        <h2 id="onboarding-heading" className="text-base font-semibold text-fg">
          Next setup step
        </h2>
        <p role="alert" className="mt-2 text-sm text-danger">
          Unable to load setup. Check your connection and try again.
        </p>
        <button
          type="button"
          onClick={() => {
            void retryChecklist();
          }}
          className="mt-3 inline-flex h-9 items-center rounded-sm border border-border px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Retry
        </button>
      </section>
    );
  }
  if (!data) return null;
  if (data.dismissed) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          disabled={checklistPending}
          onClick={() => {
            mutateChecklist({ action: 'reopen' });
          }}
          className="inline-flex items-center gap-2 rounded-sm border border-border px-2.5 py-1.5 text-xs text-fg-muted hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
        >
          <RotateCcw className="size-3" />
          Reopen setup
        </button>
        <ChecklistMutationFailure
          failed={checklistMutationFailed}
          pending={checklistPending}
          onRetry={retryChecklistMutation}
        />
      </div>
    );
  }
  const completedCount = data.items.filter((item) => item.completed).length;
  const nextItem = data.items.find((item) => !item.completed);
  const nextItemMeta = nextItem ? onboardingMeta(nextItem.key) : null;

  return (
    <section className="border-y border-border py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-base font-semibold text-fg">Next setup step</h2>
            <span className="font-mono text-xs text-fg-dim">
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
        <button
          type="button"
          disabled={checklistPending}
          onClick={() => {
            mutateChecklist({ action: 'dismiss' });
          }}
          aria-label="Dismiss setup checklist"
          className="grid size-7 place-items-center rounded-sm text-fg-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <X className="size-4" />
        </button>
      </div>
      {nextItem && nextItemMeta ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {nextItem.key === 'first_note' ? (
            <button
              type="button"
              onClick={() => {
                window.location.hash = 'capture';
              }}
              className="inline-flex h-8 items-center rounded-sm border border-border px-3 text-xs font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {nextItemMeta.cta}
            </button>
          ) : (
            <Link
              href={nextItemMeta.href}
              className="inline-flex h-8 items-center rounded-sm border border-border px-3 text-xs font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {nextItemMeta.cta}
            </Link>
          )}
          <button
            type="button"
            disabled={checklistPending}
            onClick={() => {
              mutateChecklist({ action: 'complete', key: nextItem.key });
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-xs text-fg-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
            aria-label={`Mark ${nextItem.label} complete`}
          >
            <Check className="size-3.5" />
            Mark complete
          </button>
        </div>
      ) : null}
      <ChecklistMutationFailure
        failed={checklistMutationFailed}
        pending={checklistPending}
        onRetry={retryChecklistMutation}
      />
    </section>
  );
}

function ChecklistMutationFailure({
  failed,
  pending,
  onRetry,
}: {
  failed: boolean;
  pending: boolean;
  onRetry: () => void;
}) {
  if (!failed) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <p role="alert" className="text-xs text-danger">
        Unable to update setup. Your previous setup state was restored.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={onRetry}
        className="inline-flex h-8 items-center rounded-sm border border-border px-3 text-xs font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
      >
        Retry update
      </button>
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
