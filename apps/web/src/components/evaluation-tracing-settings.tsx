'use client';

import {
  EVALUATION_CONSENT_VERSION,
  EVALUATION_SOURCES,
  EVALUATION_SOURCE_LABELS,
} from '@timeline/shared/evaluation-tracing/contract';
import Link from 'next/link';
import { useActionState } from 'react';

import {
  configureEvaluationTracingAction,
  type EvaluationActionState,
} from '@/app/actions/evaluation-tracing';
import { Button } from '@/components/ui/button';
import { notifyAction } from '@/lib/notify';

export function EvaluationTracingSettings({
  teamId,
  enabled,
  sources,
}: {
  teamId: string;
  enabled: boolean;
  sources: string[];
}) {
  const [state, action, pending] = useActionState(
    async (previous: EvaluationActionState, data: FormData) =>
      notifyAction({
        id: `evaluation-settings:${teamId}`,
        loading: 'Saving evaluation preference…',
        success: 'Evaluation preference saved',
        error: 'Couldn’t save evaluation preference',
        run: () => configureEvaluationTracingAction(previous, data),
      }),
    {},
  );
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="consentVersion" value={EVALUATION_CONSENT_VERSION} />
      <label className="flex min-h-11 items-center gap-3 font-medium">
        <input type="checkbox" name="enabled" defaultChecked={enabled} />
        Share selected source processing for quality evaluation
      </label>
      <fieldset className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">Which sources may be included?</legend>
        {EVALUATION_SOURCES.map((source) => (
          <label key={source} className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="sources"
              value={source}
              defaultChecked={sources.includes(source)}
            />
            {EVALUATION_SOURCE_LABELS[source]}
          </label>
        ))}
      </fieldset>
      <section className="space-y-3" aria-labelledby="evaluation-sharing-summary">
        <h2 id="evaluation-sharing-summary" className="text-sm font-semibold">
          What you’re agreeing to
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-fg-muted">
          <li>
            <strong className="font-medium text-fg">Shared with LangSmith:</strong> selected
            team-visible input, nearby context and extracted facts. Authorized Timeline staff can
            review samples to investigate mistakes and compare quality.
          </li>
          <li>
            <strong className="font-medium text-fg">May contain sensitive details:</strong>{' '}
            messages, names, source URLs, attachment names and Drive excerpts or comments. Samples
            are not guaranteed anonymous.
          </li>
          <li>
            <strong className="font-medium text-fg">Limits:</strong> no private/restricted records,
            full agent conversations, original file binaries or model training.
          </li>
          <li>
            <strong className="font-medium text-fg">Your control:</strong> off by default. Change or
            disable sharing anytime; previous traces are scheduled for removal. Traces are scheduled
            for deletion within 30 days; provider outages may delay removal.
          </li>
        </ul>
        <details className="border-t border-border pt-3 text-sm">
          <summary className="min-h-11 cursor-pointer font-medium">
            Sampling, captured details and deletion
          </summary>
          <div className="space-y-3 py-2 leading-6 text-fg-muted">
            <p>
              We sample 10% of eligible new extraction runs, up to 100 per workspace per day. Traces
              include model and prompt versions, timing and generic failure status. No past runs are
              backfilled.
            </p>
            <p>
              Structured GitHub events and some Drive activity bypass extraction. Selecting a source
              does not trace every event. Agent tool results are excluded; this permission does not
              grant general access to your workspace.
            </p>
            <p>
              Changing permission stops new collection under the old permission. Provider cleanup
              may take time and is not instant erasure of backups.
            </p>
          </div>
        </details>
      </section>
      <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
        <input className="mt-1.5" type="checkbox" name="consent" />
        <span>
          I am authorized to enable this for the workspace and have informed affected members. I
          understand that selected content will be sent to LangSmith for quality evaluation. Leave
          sharing off to continue without it.
        </span>
      </label>
      <p className="text-sm text-fg-muted">
        Acknowledgment is required to enable or update sharing, never to turn it off. Read our{' '}
        <Link href="/privacy" className="underline">
          Privacy Policy
        </Link>{' '}
        and{' '}
        <Link href="/trust" className="underline">
          Trust page
        </Link>
        .
      </p>
      {state.error && (
        <p role="alert" className="text-sm">
          {state.error}
        </p>
      )}
      <Button variant="outline" type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save evaluation preference'}
      </Button>
    </form>
  );
}
