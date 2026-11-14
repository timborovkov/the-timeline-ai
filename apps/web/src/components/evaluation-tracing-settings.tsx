'use client';

import {
  EVALUATION_CONSENT_VERSION,
  EVALUATION_SOURCES,
  EVALUATION_SOURCE_LABELS,
} from '@timeline/shared/evaluation-tracing/contract';
import Link from 'next/link';
import { useActionState } from 'react';

import { configureEvaluationTracingAction } from '@/app/actions/evaluation-tracing';
import { Button } from '@/components/ui/button';

export function EvaluationTracingSettings({
  teamId,
  enabled,
  sources,
}: {
  teamId: string;
  enabled: boolean;
  sources: string[];
}) {
  const [state, action, pending] = useActionState(configureEvaluationTracingAction, {});
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="consentVersion" value={EVALUATION_CONSENT_VERSION} />
      <label className="flex min-h-11 items-center gap-3 font-medium">
        <input type="checkbox" name="enabled" defaultChecked={enabled} />
        Share selected source processing for quality evaluation
      </label>
      <fieldset className="space-y-2">
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
      <div className="space-y-3 text-sm leading-6 text-fg-muted">
        <p>
          We sample 10% of eligible new extraction runs, up to 100 per workspace per day. These runs
          turn incoming source text into facts. A trace includes the text sent to the model, nearby
          conversation context, extracted facts, model and prompt versions, timing, and whether the
          call failed. Structured GitHub events and some Drive activity bypass extraction, so
          selecting a source does not trace every event.
        </p>
        <p>
          Only team-visible records from your selected sources qualify. Private or restricted
          records, full agent conversations, agent tool results and original file binaries are
          excluded. Names of attachments, source URLs, and Google Drive change excerpts or comments
          may be included when they are part of the event text sent to the model.
        </p>
        <p>
          LangSmith stores these traces so authorized Timeline staff can investigate mistakes and
          compare model and prompt quality. Traces can contain names, messages and confidential
          details; they are not guaranteed to be anonymized. This does not authorize model training
          or general access to your workspace.
        </p>
        <p>
          Traces are scheduled for deletion within 30 days. Changing or disabling this setting stops
          collection under the old permission and requests removal of its traces. Provider cleanup
          may take time; it is not instant erasure of backups. No data is backfilled.
        </p>
      </div>
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
      {state.saved && (
        <p role="status" className="text-sm">
          Evaluation preference saved. Changing permission also schedules deletion of earlier
          traces.
        </p>
      )}
      <Button variant="outline" type="submit" disabled={pending}>
        Save evaluation preference
      </Button>
    </form>
  );
}
