'use client';

import { Check, RotateCcw, X } from 'lucide-react';

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
  return (
    <section className="rounded-sm border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
          Setup checklist
        </h2>
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
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {data.items.map((item) => (
          <li
            key={item.key}
            className="flex items-center justify-between rounded-sm border border-border bg-bg px-3 py-2 text-sm"
          >
            <span>{item.label}</span>
            <button
              type="button"
              disabled={item.completed || checklistPending}
              onClick={() => {
                mutateChecklist({ action: 'complete', key: item.key });
              }}
              className="grid size-7 place-items-center rounded-sm text-fg-muted hover:bg-surface disabled:text-signal"
              aria-label={item.completed ? `${item.label} complete` : `Mark ${item.label} complete`}
            >
              <Check className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
