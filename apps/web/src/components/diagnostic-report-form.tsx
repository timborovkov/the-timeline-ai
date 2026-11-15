'use client';
import {
  DIAGNOSTIC_CONSENT_VERSION,
  DIAGNOSTIC_TEXT_LIMIT,
  formatDiagnosticConversation,
  type DiagnosticMessage,
} from '@timeline/shared/diagnostics/contract';
import { Check, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useState } from 'react';

import {
  configureDiagnosticAction,
  type DiagnosticActionState,
  deleteDiagnosticAction,
  submitDiagnosticAction,
} from '@/app/actions/diagnostics';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { notifyAction } from '@/lib/notify';

interface MessageDraft extends DiagnosticMessage {
  included: boolean;
}

export function DiagnosticReportForm({
  teamId,
  sessionId,
  initialMessages,
}: {
  teamId: string;
  sessionId: string;
  initialMessages: DiagnosticMessage[];
}) {
  const [state, action, pending] = useActionState(submitDiagnosticAction, {});
  const [description, setDescription] = useState('');
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- An editable draft is initialized once per session-keyed form; refreshed props must not overwrite redactions or exclusions.
  const [messages, setMessages] = useState<MessageDraft[]>(() =>
    initialMessages.map((message) => ({ ...message, included: true })),
  );
  const [consent, setConsent] = useState(false);
  const selected = messages.filter((message) => message.included && message.text.trim());
  const text = formatDiagnosticConversation(selected);
  function changeMessage(id: string, update: Partial<Pick<MessageDraft, 'text' | 'included'>>) {
    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, ...update } : message)),
    );
    setConsent(false);
  }
  if (state.saved) return <ReportShared sessionId={sessionId} />;
  return (
    <form action={action} className="space-y-8">
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="consentVersion" value={DIAGNOSTIC_CONSENT_VERSION} />
      <input type="hidden" name="conversation" value={text} />
      <fieldset disabled={pending} className="space-y-8">
        <div className="space-y-2">
          <label htmlFor="diagnostic-description" className="font-medium">
            What went wrong?
          </label>
          <Textarea
            id="diagnostic-description"
            name="description"
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              setConsent(false);
            }}
            required
            minLength={10}
            maxLength={2000}
            rows={3}
            placeholder="What did you expect, and what happened instead?"
          />
        </div>
        <section aria-labelledby="diagnostic-messages" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="diagnostic-messages" className="font-semibold">
              Choose messages to share
            </h2>
            <span className="text-sm text-fg-muted" role="status">
              {selected.length} of {messages.length} messages selected
            </span>
          </div>
          <p className="text-sm text-fg-muted">
            Uncheck any message to leave it out. Use Edit to remove names or sensitive details.
          </p>
          <div className="divide-y divide-border border-y border-border">
            {messages.map((message, index) => (
              <ReportMessage
                key={message.id}
                message={message}
                number={index + 1}
                onChange={(update) => {
                  changeMessage(message.id, update);
                }}
              />
            ))}
          </div>
          {messages.length === 0 && (
            <p className="text-sm text-fg-muted">
              This conversation has no text messages to share.
            </p>
          )}
          {text.length > DIAGNOSTIC_TEXT_LIMIT && (
            <p role="alert" className="text-sm text-destructive">
              The selected messages are too long. Remove or shorten messages to fit 60,000
              characters.
            </p>
          )}
        </section>
        <ReportConsent consent={consent} onChange={setConsent} />
        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <Button
            type="submit"
            disabled={
              pending || !consent || selected.length === 0 || text.length > DIAGNOSTIC_TEXT_LIMIT
            }
          >
            {pending ? 'Sending…' : 'Share report'}
          </Button>
          <Link
            href={`/app/chat?session=${encodeURIComponent(sessionId)}`}
            className="inline-flex min-h-11 items-center text-sm text-fg-muted underline underline-offset-4"
          >
            Cancel
          </Link>
        </div>
      </fieldset>
    </form>
  );
}

function ReportMessage({
  message,
  number,
  onChange,
}: {
  message: MessageDraft;
  number: number;
  onChange: (update: Partial<Pick<MessageDraft, 'text' | 'included'>>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const speaker = message.role === 'user' ? 'You' : 'Assistant';
  return (
    <div className="space-y-2 py-4">
      <div className="flex items-center justify-between gap-3">
        <label className="flex min-h-11 items-center gap-3 font-medium">
          <input
            type="checkbox"
            checked={message.included}
            onChange={(event) => {
              onChange({ included: event.target.checked });
            }}
            aria-label={`Include message ${number} from ${speaker}`}
            className="size-4 accent-primary"
          />
          <span>
            {speaker}
            <span className="ml-2 text-xs font-normal text-fg-muted">Message {number}</span>
          </span>
        </label>
        {message.included && (
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              setEditing(!editing);
            }}
            aria-label={`${editing ? 'Done editing' : 'Edit'} message ${number}`}
          >
            {editing ? 'Done' : 'Edit'}
          </Button>
        )}
      </div>
      {!message.included ? (
        <p className="pl-7 text-sm text-fg-muted">Not included in this report.</p>
      ) : editing ? (
        <Textarea
          aria-label={`Message ${number} text`}
          value={message.text}
          onChange={(event) => {
            onChange({ text: event.target.value });
          }}
          rows={Math.min(10, Math.max(3, message.text.split('\n').length + 1))}
        />
      ) : (
        <p className="whitespace-pre-wrap break-words pl-7 text-sm leading-relaxed">
          {message.text || 'Empty message — not included.'}
        </p>
      )}
    </div>
  );
}

function ReportConsent({
  consent,
  onChange,
}: {
  consent: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <section className="space-y-3 rounded-sm bg-muted/40 p-4" aria-label="Sharing and privacy">
      <p className="text-sm">
        Only your description and selected message text are shared. Hidden tool results, attachments
        and source documents stay out.
      </p>
      <p className="text-sm text-fg-muted">
        Authorized support staff can review your report. It expires after 30 days, and you can
        delete it sooner. No model training.
      </p>
      <details className="text-sm text-fg-muted">
        <summary className="inline-flex min-h-11 cursor-pointer items-center underline underline-offset-4">
          Storage and privacy details
        </summary>
        <p className="mt-2">
          Reports stay in Timeline’s encrypted storage and are not sent to LangSmith. Workspace and
          sender identifiers, consent version, and submission and expiry times accompany the report.
          Expired reports are removed by scheduled cleanup. Backup copies may remain under backup
          retention, and consent and access audit records are kept separately. Sharing does not
          grant access to other conversations or workspace data.
        </p>
      </details>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="consent"
          checked={consent}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
          required
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <span>
          I’ve reviewed the selected content and am authorized to share it with Timeline support.
        </span>
      </label>
    </section>
  );
}

function ReportShared({ sessionId }: { sessionId: string }) {
  return (
    <div className="space-y-4 border-t border-border pt-6">
      <div className="flex items-center gap-2 font-medium" role="status">
        <Check aria-hidden="true" className="size-5 text-primary" />
        Report shared
      </div>
      <p className="text-sm text-fg-muted">
        Thank you for helping us investigate. Your report expires after 30 days. You can delete it
        from your shared reports at any time before then.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href="/app/diagnostics">View shared reports</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href={`/app/chat?session=${encodeURIComponent(sessionId)}`}>
            <ChevronLeft aria-hidden="true" />
            Back to conversation
          </Link>
        </Button>
      </div>
    </div>
  );
}
export function DiagnosticSharingSettings({
  teamId,
  enabled,
}: {
  teamId: string;
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState(
    async (previous: DiagnosticActionState, data: FormData) =>
      notifyAction({
        id: `conversation-sharing:${teamId}`,
        loading: 'Saving sharing preference…',
        success: 'Sharing preference saved',
        error: 'Couldn’t save sharing preference',
        run: () => configureDiagnosticAction(previous, data),
      }),
    {},
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="teamId" value={teamId} />
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" name="enabled" defaultChecked={enabled} />
        Allow members to share conversation reports with Timeline support
      </label>
      <p className="text-sm text-fg-muted">
        Each report still requires the member’s explicit consent. Disabling sharing stops new
        submissions; existing reports keep their expiry date.
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      <Button variant="outline" type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save sharing preference'}
      </Button>
    </form>
  );
}
export function DeleteDiagnosticReport({ teamId, reportId }: { teamId: string; reportId: string }) {
  const [state, action, pending] = useActionState(deleteDiagnosticAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="reportId" value={reportId} />
      <Button variant="outline" type="submit" disabled={pending}>
        Delete shared report
      </Button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
