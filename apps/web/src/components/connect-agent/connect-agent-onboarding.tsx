'use client';

import Link from 'next/link';
import { useEffect, useRef, type ButtonHTMLAttributes, type RefObject } from 'react';

import type { OnboardingChecklistView } from '@/lib/onboarding-checklist';

import { Button } from '@/components/ui/button';
import { CONNECT_AGENT_HREF } from '@/lib/connect-agent-content';
import { notifyError } from '@/lib/notify';
import { useHydrated } from '@/lib/use-hydrated';
import { useOnboardingChecklistQuery } from '@/lib/use-paginated-queries';
import { cn } from '@/lib/utils';

export function ConnectAgentOnboardingCard({
  initialData = null,
}: {
  initialData?: OnboardingChecklistView | null;
}) {
  const {
    data: queryData,
    isPending,
    checklistLoadFailed,
    mutateChecklist,
    checklistPending,
    checklistMutationFailed,
    retryChecklistMutation,
  } = useOnboardingChecklistQuery(initialData ?? undefined);
  const hydrated = useHydrated();
  const data = hydrated ? (queryData ?? initialData) : initialData;
  const skipRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!checklistMutationFailed) return;
    notifyError('onboarding:connect-agent', 'Couldn’t skip Connect your agent');
  }, [checklistMutationFailed]);

  if (!data && (!hydrated || isPending || checklistLoadFailed)) return null;
  if (!data) return null;

  const step = data.items.find((item) => item.key === 'connect_agent');
  if (!step || step.completed) return null;

  return (
    <section
      aria-labelledby="connect-agent-onboarding-heading"
      className="border-y border-border py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl space-y-1">
          <h2
            id="connect-agent-onboarding-heading"
            className="text-base font-semibold tracking-tight text-fg"
          >
            Connect your agent
          </h2>
          <p className="text-sm leading-6 text-fg-muted">
            Point Claude, Codex, ChatGPT, Cursor, or another MCP client at this team. Answers appear
            once work is captured. Remember works now.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <Link href={CONNECT_AGENT_HREF}>Connect your agent</Link>
          </Button>
          <QuietTextButton
            ref={skipRef}
            disabled={checklistPending}
            aria-label="Skip connect your agent"
            onClick={() => {
              mutateChecklist({ action: 'complete', key: 'connect_agent' });
            }}
          >
            Skip
          </QuietTextButton>
        </div>
      </div>
      {checklistMutationFailed ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={checklistPending}
          onClick={() => {
            retryChecklistMutation();
          }}
        >
          Retry
        </Button>
      ) : null}
    </section>
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
