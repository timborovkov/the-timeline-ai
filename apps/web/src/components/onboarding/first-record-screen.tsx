'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import type { FirstRunSource, FirstRunSuggestion } from '@timeline/shared/onboarding/first-run';

import { setFirstRunPhaseAction } from '@/app/actions/first-run';
import { SuggestionStatusPill } from '@/components/onboarding/suggestion-status-pill';
import { Button } from '@/components/ui/button';

export function FirstRecordScreen({
  title,
  meta,
  summary,
  note,
  sources,
  suggestions,
}: {
  title: string;
  meta: string;
  summary: string | null;
  note: string;
  sources: FirstRunSource[];
  suggestions: FirstRunSuggestion[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function go(href: string, phase: 'ask' | 'approve') {
    startTransition(() => {
      void setFirstRunPhaseAction(phase).then(() => {
        router.push(href);
      });
    });
  }

  return (
    <div className="max-w-3xl">
      <p className="text-xs text-fg-dim">Your first record</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
      {meta ? <p className="mt-1 font-mono text-xs text-fg-dim">{meta}</p> : null}
      {summary ? (
        <div className="mt-4 rounded-md border border-border bg-surface p-4">
          <p className="text-sm leading-6 text-fg">{summary}</p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-fg-muted">
          The cited summary appears here once extraction finishes.
        </p>
      )}
      <p className="mt-3 text-sm leading-6 text-fg-muted">{note}</p>

      <h2 className="mt-6 text-base font-semibold">Sources</h2>
      <ul className="mt-2 border-t border-border">
        {sources.length === 0 ? (
          <li className="py-2 text-sm text-fg-muted">Sources appear as this capture is indexed.</li>
        ) : (
          sources.map((source) => (
            <li
              key={`${source.n}-${source.title}`}
              className="flex flex-wrap items-baseline gap-2.5 border-b border-border py-2"
            >
              <span className="rounded-sm bg-signal-soft px-1 font-mono text-[11px] text-signal">
                {source.n}
              </span>
              <span className="w-[5.5rem] text-xs text-fg-dim">{source.kind}</span>
              {source.href ? (
                <Link href={source.href} className="text-sm text-fg hover:underline">
                  {source.title}
                </Link>
              ) : (
                <span className="text-sm text-fg">{source.title}</span>
              )}
              <span className="font-mono text-xs text-fg-dim">{source.meta}</span>
            </li>
          ))
        )}
      </ul>

      <h2 className="mt-6 text-base font-semibold">Suggested from this</h2>
      <ul className="mt-2 border-t border-border">
        {suggestions.length === 0 ? (
          <li className="py-2 text-sm text-fg-muted">
            Suggestions appear here after this capture is reviewed. Nothing becomes a lasting record
            until you approve it.
          </li>
        ) : (
          suggestions.map((suggestion) => {
            const source = sources.find((item) => item.n === suggestion.sourceN);
            return (
              <li
                key={suggestion.id}
                className="flex flex-wrap items-center gap-3 border-b border-border py-2.5"
              >
                <span className="w-14 text-xs text-fg-dim">{suggestion.type}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{suggestion.title}</div>
                  <div className="mt-0.5 text-xs text-fg-dim">
                    {suggestion.detail}
                    {source ? (
                      <>
                        {' '}
                        · from{' '}
                        <span className="rounded-sm bg-signal-soft px-1 font-mono text-[11px] text-signal">
                          {source.n}
                        </span>{' '}
                        {source.title}
                      </>
                    ) : null}
                  </div>
                </div>
                <SuggestionStatusPill status={suggestion.status} />
              </li>
            );
          })
        )}
      </ul>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            go('/app/chat', 'ask');
          }}
        >
          Ask about it
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            go('/app/approvals', 'approve');
          }}
        >
          Review suggestions
        </Button>
      </div>
    </div>
  );
}
