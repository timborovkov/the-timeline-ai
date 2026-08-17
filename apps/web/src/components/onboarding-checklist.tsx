'use client';

import { Check, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, type ButtonHTMLAttributes, type RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useOnboardingChecklistQuery } from '@/lib/use-paginated-queries';
import { cn } from '@/lib/utils';

export const TEAM_SETUP_CHECKLIST_PANEL_ID = 'team-setup-checklist-panel';

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

  useEffect(() => {
    if (!data || data.dismissed) return;
    if (window.location.hash !== `#${TEAM_SETUP_CHECKLIST_PANEL_ID}`) return;
    document.getElementById(TEAM_SETUP_CHECKLIST_PANEL_ID)?.scrollIntoView({ block: 'start' });
  }, [data]);

  const updateStatus = (
    <output aria-live="polite" aria-atomic="true" className="sr-only">
      {checklistPending ? 'Updating checklist…' : ''}
    </output>
  );

  if (isPending) {
    return (
      <>
        {updateStatus}
        <section
          aria-busy="true"
          aria-label="Loading team setup checklist"
          className="border-y border-border py-4"
        >
          <Skeleton className="h-5 w-36 motion-reduce:animate-none" />
          <div className="mt-3 space-y-3">
            <Skeleton className="h-4 w-56 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-full max-w-lg motion-reduce:animate-none" />
            <Skeleton className="h-4 w-48 motion-reduce:animate-none" />
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
          <h2 id="onboarding-heading" className="text-xs font-normal text-fg-dim">
            Team setup checklist
          </h2>
          <p role="alert" className="mt-2 text-sm text-danger">
            Unable to load the team setup checklist. Check your connection and try again.
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
  const completedCount = data.items.filter((item) => item.completed).length;

  if (data.dismissed) {
    return (
      <>
        {updateStatus}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <QuietTextButton
            ref={reopenButtonRef}
            disabled={checklistPending}
            aria-expanded={false}
            aria-controls={TEAM_SETUP_CHECKLIST_PANEL_ID}
            onClick={() => {
              lastMutationKind.current = 'reopen';
              pendingFocusTarget.current = 'dismiss';
              mutateChecklist({ action: 'reopen' });
            }}
            className="inline-flex items-center gap-1"
          >
            Team setup checklist
            <ChevronRight aria-hidden="true" className="size-3" />
          </QuietTextButton>
          {data.items.length > 0 ? (
            <span
              aria-label={`${completedCount} of ${data.items.length} checklist steps complete`}
              className="font-mono text-[11px] text-fg-dim"
            >
              {completedCount}/{data.items.length}
            </span>
          ) : null}
        </div>
        <ChecklistMutationFailure
          failed={checklistMutationFailed}
          pending={checklistPending}
          onRetry={retryMutation}
          retryButtonRef={retryButtonRef}
        />
      </>
    );
  }
  const nextItem = data.items.find((item) => !item.completed);

  return (
    <>
      {updateStatus}
      <section
        id={TEAM_SETUP_CHECKLIST_PANEL_ID}
        aria-labelledby="onboarding-heading"
        className="scroll-mt-16 border-y border-border py-4"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-2">
            <h2 id="onboarding-heading" className="text-xs font-normal text-fg-dim">
              Team setup checklist
            </h2>
            <span
              aria-label={`${completedCount} of ${data.items.length} checklist steps complete`}
              className="font-mono text-[11px] text-fg-dim"
            >
              {completedCount}/{data.items.length}
            </span>
          </div>
          <QuietTextButton
            ref={dismissButtonRef}
            disabled={checklistPending}
            aria-expanded={true}
            aria-controls={TEAM_SETUP_CHECKLIST_PANEL_ID}
            aria-label="Hide team setup checklist"
            onClick={() => {
              lastMutationKind.current = 'dismiss';
              pendingFocusTarget.current = 'reopen';
              mutateChecklist({ action: 'dismiss' });
            }}
          >
            Hide
          </QuietTextButton>
        </div>
        <ol className="mt-3 divide-y divide-border border-t border-border">
          {data.items.map((item, index) => {
            const meta = onboardingMeta(item.key);
            const isNext = nextItem?.key === item.key;
            return (
              <li key={item.key} className="flex items-start gap-3 py-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border font-mono text-[10px]',
                    item.completed
                      ? 'border-signal/40 text-signal'
                      : isNext
                        ? 'border-border-strong text-fg'
                        : 'border-border text-fg-dim',
                  )}
                >
                  {item.completed ? <Check className="size-3" /> : index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  {item.completed ? (
                    <p className="text-sm text-fg-muted">{item.label}</p>
                  ) : isNext ? (
                    <p className="text-sm font-medium text-fg">{item.label}</p>
                  ) : (
                    <p className="text-sm text-fg-dim">
                      <Link
                        href={meta.href}
                        className="underline decoration-fg-dim underline-offset-2 transition-colors hover:text-fg hover:decoration-fg"
                      >
                        {item.label}
                      </Link>
                    </p>
                  )}
                  {isNext ? (
                    <>
                      <p className="mt-0.5 text-xs text-fg-muted">{meta.description}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {item.key === 'first_note' ? (
                          <Button
                            type="button"
                            onClick={() => {
                              window.location.hash = 'capture';
                            }}
                            variant="outline"
                            size="sm"
                          >
                            {meta.cta}
                          </Button>
                        ) : (
                          <Button asChild variant="outline" size="sm">
                            <Link href={meta.href}>{meta.cta}</Link>
                          </Button>
                        )}
                        <QuietTextButton
                          ref={nextActionRef}
                          disabled={checklistPending}
                          aria-label={`Mark ${item.label} complete`}
                          onClick={() => {
                            lastMutationKind.current = 'complete';
                            pendingFocusTarget.current = 'next-action';
                            mutateChecklist({ action: 'complete', key: item.key });
                          }}
                        >
                          Mark complete
                        </QuietTextButton>
                      </div>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
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

function QuietTextButton({
  ref,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      {...props}
      ref={ref}
      type="button"
      className={cn(
        'rounded-sm text-xs text-fg-dim transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong disabled:opacity-40',
        className,
      )}
    />
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
        Unable to update the team setup checklist. Your previous state was restored.
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
    case 'invite_teammate':
      return {
        href: '/app/team?section=members',
        cta: 'Invite',
        description: 'Bring someone else onto the team so capture and memory are shared.',
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
        description: 'Add a file to the team drive so the agent can search and cite it.',
      };
    case 'first_ask':
      return {
        href: '/app/chat',
        cta: 'Ask',
        description: 'Ask what changed, who owns something, or what is overdue.',
      };
    case 'first_meeting':
      return {
        href: '/app/meetings',
        cta: 'Schedule',
        description: 'Send the silent bot to a call so the transcript lands in the timeline.',
      };
    case 'review_proposal':
      return {
        href: '/app/approvals',
        cta: 'Open approvals',
        description: 'Accept or reject one suggested change to a task, object, or board.',
      };
    case 'daily_digest':
      return {
        href: '/app/team?section=general',
        cta: 'Open settings',
        description: 'Choose whether the morning summary should arrive, and at what hour.',
      };
    case 'first_integration':
      return {
        href: '/app/sources',
        cta: 'Connect',
        description:
          'Connect Drive, Linear, or GitHub, add a custom webhook, or share Timeline as MCP with Claude Desktop.',
      };
    default:
      return {
        href: '/app',
        cta: 'Open',
        description: 'Complete this step when ready.',
      };
  }
}
