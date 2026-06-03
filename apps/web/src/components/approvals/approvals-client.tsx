'use client';

import { Check, CheckCheck, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  acceptAllSuggestionAction,
  acceptSuggestionItemAction,
  rejectSuggestionItemAction,
} from '@/app/actions/suggestions';
import { EmptyAction } from '@/components/empty-action';
import { Button } from '@/components/ui/button';

interface SuggestionItem {
  id: string;
  status: string;
  operation: string;
  targetKind: string;
  targetId: string | null;
  title: string;
  description: string | null;
  proposedPayload: Record<string, unknown>;
  failureReason: string | null;
}

interface SuggestionBundle {
  id: string;
  source: string;
  status: string;
  title: string;
  summary: string | null;
  reason: string | null;
  confidence: string;
  createdAt: string;
  items: SuggestionItem[];
  evidence: {
    rawEventId: string;
    quote: string | null;
    occurredAt: string | null;
    source: string | null;
  }[];
}

interface Props {
  suggestions: SuggestionBundle[];
}

function formatPayload(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${formatPayloadValue(value)}`)
    .join(' · ');
}

function formatPayloadValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

export function ApprovalsClient({ suggestions }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok?: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      router.refresh();
    });
  }

  if (suggestions.length === 0) {
    return (
      <EmptyAction
        title="No pending approvals"
        body="When the agent proposes tasks, objects, calendar items, or document changes, they will queue here before becoming canonical."
        href="/app"
        action="Back to home"
      />
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="border border-danger/40 px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-danger">
          {error}
        </div>
      ) : null}

      {suggestions.map((bundle) => {
        const pendingItems = bundle.items.filter(
          (item) => item.status === 'pending' || item.status === 'failed',
        );
        return (
          <article key={bundle.id} className="border-y border-border py-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                  {bundle.source} · {bundle.confidence} ·{' '}
                  {new Date(bundle.createdAt).toLocaleString()}
                </div>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-fg">
                  {bundle.title}
                </h2>
                {bundle.summary ? (
                  <p className="mt-1 text-sm text-fg-muted">{bundle.summary}</p>
                ) : null}
                {bundle.reason ? <p className="mt-1 text-xs text-fg-dim">{bundle.reason}</p> : null}
              </div>
              {pendingItems.length > 1 ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    run(() => acceptAllSuggestionAction({ suggestionId: bundle.id }));
                  }}
                >
                  <CheckCheck className="size-4" />
                  Accept all
                </Button>
              ) : null}
            </div>

            <ul className="mt-4 divide-y divide-border border border-border">
              {bundle.items.map((item) => (
                <li key={item.id} className="grid gap-3 bg-bg p-3 md:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                      {item.operation.replace(/_/g, ' ')} · {item.targetKind.replace(/_/g, ' ')} ·{' '}
                      {item.status}
                    </div>
                    <div className="mt-1 font-medium text-fg">{item.title}</div>
                    {item.description ? (
                      <p className="mt-1 text-sm text-fg-muted">{item.description}</p>
                    ) : null}
                    <p className="mt-1 truncate font-mono text-[11px] text-fg-dim">
                      {formatPayload(item.proposedPayload)}
                    </p>
                    {item.failureReason ? (
                      <p className="mt-1 text-xs text-danger">{item.failureReason}</p>
                    ) : null}
                  </div>
                  {item.status === 'pending' || item.status === 'failed' ? (
                    <div className="flex items-start gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          run(() => acceptSuggestionItemAction({ itemId: item.id }));
                        }}
                      >
                        <Check className="size-4" />
                        Accept
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          run(() => rejectSuggestionItemAction({ itemId: item.id }));
                        }}
                      >
                        <X className="size-4" />
                        Reject
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            {bundle.evidence.length > 0 ? (
              <div className="mt-3 space-y-1 text-xs text-fg-dim">
                {bundle.evidence.map((ev) => (
                  <p key={ev.rawEventId}>
                    <span className="font-mono">[ev:{ev.rawEventId.slice(0, 8)}]</span>{' '}
                    {ev.quote ?? ev.source ?? 'source event'}
                  </p>
                ))}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
