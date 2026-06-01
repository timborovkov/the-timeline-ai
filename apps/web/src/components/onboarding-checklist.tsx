'use client';

import { Check, CheckCircle2, Circle, RotateCcw, X } from 'lucide-react';
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
        className="inline-flex items-center gap-2 rounded-sm border border-border px-2 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted hover:bg-surface"
      >
        <RotateCcw className="size-3" />
        Reopen setup
      </button>
    );
  }
  const completedCount = data.items.filter((item) => item.completed).length;

  return (
    <section className="rounded-sm border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
            Setup checklist
          </h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted">
            {completedCount}/{data.items.length} complete
          </span>
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
      <ul className="flex gap-px overflow-x-auto bg-border [scrollbar-width:thin]">
        {data.items.map((item) => (
          <li
            key={item.key}
            className="flex min-h-44 w-64 shrink-0 flex-col justify-between bg-bg px-4 py-3 text-sm leading-5"
          >
            <span className="min-w-0">
              <span className="flex items-start gap-2">
                {item.completed ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden="true" />
                ) : (
                  <Circle className="mt-0.5 size-4 shrink-0 text-fg-dim" aria-hidden="true" />
                )}
                <span className="font-medium text-fg">{item.label}</span>
              </span>
              <span className="mt-1 block text-xs text-fg-muted">
                {onboardingMeta(item.key).description}
              </span>
            </span>
            <span className="mt-4 flex items-center gap-2">
              {item.completed ? (
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-signal">
                  Done
                </span>
              ) : (
                <>
                  <Link
                    href={onboardingMeta(item.key).href}
                    className="inline-flex min-h-8 items-center rounded-sm border border-border px-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                  >
                    {onboardingMeta(item.key).cta}
                  </Link>
                  <button
                    type="button"
                    disabled={checklistPending}
                    onClick={() => {
                      mutateChecklist({ action: 'complete', key: item.key });
                    }}
                    className="grid size-8 place-items-center rounded-sm text-fg-muted hover:bg-surface-2 disabled:opacity-50"
                    aria-label={`Mark ${item.label} complete`}
                  >
                    <Check className="size-4" />
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function onboardingMeta(key: string): { href: string; cta: string; description: string } {
  switch (key) {
    case 'first_note':
      return {
        href: '#capture',
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
        href: '#email-ingest',
        cta: 'Copy email',
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
        href: '/app/team/integrations',
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
