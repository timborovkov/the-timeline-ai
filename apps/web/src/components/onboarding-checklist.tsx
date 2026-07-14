'use client';

import { Check, CheckCircle2, RotateCcw, X } from 'lucide-react';
import Link from 'next/link';

import { useOnboardingChecklistQuery } from '@/lib/use-paginated-queries';

export function OnboardingChecklist() {
  const { data, isPending, mutateChecklist, checklistPending } = useOnboardingChecklistQuery();
  if (isPending) return null;
  if (!data) return null;
  if (data.dismissed) {
    return (
      <button
        type="button"
        onClick={() => {
          mutateChecklist({ action: 'reopen' });
        }}
        className="inline-flex items-center gap-2 rounded-sm border border-border px-2.5 py-1.5 text-xs text-fg-muted hover:bg-surface"
      >
        <RotateCcw className="size-3" />
        Reopen setup
      </button>
    );
  }
  const completedCount = data.items.filter((item) => item.completed).length;
  const nextItem = data.items.find((item) => !item.completed);

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
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
                  {onboardingMeta(nextItem.key).description}
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
          className="grid size-7 place-items-center rounded-sm text-fg-muted hover:bg-surface-2"
        >
          <X className="size-4" />
        </button>
      </div>
      {nextItem ? (
        <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
          <Link
            href={onboardingMeta(nextItem.key).href}
            className="inline-flex h-8 items-center rounded-sm border border-border px-3 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
          >
            {onboardingMeta(nextItem.key).cta}
          </Link>
          <button
            type="button"
            disabled={checklistPending}
            onClick={() => {
              mutateChecklist({ action: 'complete', key: nextItem.key });
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-xs text-fg-muted hover:bg-surface-2 disabled:opacity-50"
            aria-label={`Mark ${nextItem.label} complete`}
          >
            <Check className="size-3.5" />
            Mark complete
          </button>
        </div>
      ) : null}
    </section>
  );
}

function onboardingMeta(key: string): { href: string; cta: string; description: string } {
  switch (key) {
    case 'first_note':
      return {
        href: '/app',
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
