'use client';

import { useState, useTransition } from 'react';

import { inspectSuggestionEvidenceAction } from '@/app/actions/approval-preview';
import { EvidenceLink } from '@/components/evidence-link';
import { Button } from '@/components/ui/button';
import { displayText, formatDisplayDateTime } from '@/lib/display-dates';
import { evidenceSourceLabel } from '@/lib/evidence-source-label';

export function StaleEvidence({ itemId, timezone }: { itemId: string; timezone: string }) {
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof inspectSuggestionEvidenceAction>
  > | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-2">
        <p role="status" className="text-sm text-danger">
          Source evidence changed. Acceptance is blocked.
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            if (open) {
              setResult(null);
              return;
            }
            startTransition(async () => {
              setResult(
                await inspectSuggestionEvidenceAction({ itemId }).catch(() => ({
                  error: 'Could not inspect evidence. Try again.',
                })),
              );
            });
          }}
          disabled={pending}
        >
          {open ? 'Hide changes' : 'Inspect changes'}
        </Button>
      </div>
      {open && pending ? (
        <p role="status" className="text-sm text-fg-muted">
          Checking evidence…
        </p>
      ) : null}
      {open && result?.error ? (
        <p role="alert" className="text-sm text-danger">
          {result.error}
        </p>
      ) : null}
      {open && result?.changes ? (
        <div className="space-y-3">
          {result.changes.length === 0 ? (
            <p className="text-sm text-fg-muted">
              No changed evidence is visible. Refresh the approval queue.
            </p>
          ) : (
            result.changes.map((change) => (
              <section
                key={change.rawEventId}
                className="space-y-2 rounded-sm border border-border p-3 text-sm"
              >
                <EvidenceLink
                  eventId={change.rawEventId}
                  source={change.source}
                  occurredAt={change.occurredAt}
                >
                  {evidenceSourceLabel(change.source)}
                  {change.occurredAt
                    ? ` · ${formatDisplayDateTime(change.occurredAt, { timezone })}`
                    : ''}
                </EvidenceLink>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="font-medium">Saved quote</dt>
                    <dd className="whitespace-pre-wrap break-words text-fg-muted">
                      {change.savedQuote
                        ? displayText(change.savedQuote, { timezone })
                        : 'No quote saved'}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">Current source excerpt</dt>
                    <dd className="whitespace-pre-wrap break-words text-fg-muted">
                      {change.currentText
                        ? displayText(change.currentText, { timezone })
                        : 'Source text unavailable'}
                    </dd>
                  </div>
                </dl>
                {change.savedQuote && change.currentText?.includes(change.savedQuote) ? (
                  <p className="text-fg-muted">
                    The saved quote still appears in the source. Its date or surrounding text may
                    have changed.
                  </p>
                ) : null}
              </section>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
