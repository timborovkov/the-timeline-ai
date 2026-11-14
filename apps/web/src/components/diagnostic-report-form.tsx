'use client';
import {
  DIAGNOSTIC_CONSENT_VERSION,
  DIAGNOSTIC_TEXT_LIMIT,
} from '@timeline/shared/diagnostics/contract';
import { useActionState, useState } from 'react';

import {
  configureDiagnosticAction,
  deleteDiagnosticAction,
  submitDiagnosticAction,
} from '@/app/actions/diagnostics';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function DiagnosticReportForm({
  teamId,
  sessionId,
  conversation,
}: {
  teamId: string;
  sessionId: string;
  conversation: string;
}) {
  const [state, action, pending] = useActionState(submitDiagnosticAction, {});
  const [description, setDescription] = useState('');
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- This is an editable draft initialized once per session-keyed form; server refreshes must not overwrite the sender’s redactions.
  const [text, setText] = useState(conversation);
  const [consent, setConsent] = useState(false);
  if (state.saved)
    return (
      <p role="status">
        Report shared. You can delete it below. Thank you for helping us investigate.
      </p>
    );
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="consentVersion" value={DIAGNOSTIC_CONSENT_VERSION} />
      <div className="space-y-2">
        <label htmlFor="diagnostic-description">What went wrong?</label>
        <Textarea
          id="diagnostic-description"
          name="description"
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
          required
          minLength={10}
          maxLength={2000}
          placeholder="Tell us what you expected and what happened."
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="diagnostic-conversation">Conversation to share</label>
        <p id="diagnostic-help" className="text-sm text-fg-muted">
          Review every message. Delete messages or edit sensitive details before sending. Only the
          text in these two fields is shared; attachments, hidden tool results and source documents
          are not included.
        </p>
        {text.length > DIAGNOSTIC_TEXT_LIMIT && (
          <p role="status">
            This conversation is too long to submit. Remove unnecessary messages to fit 60,000
            characters.
          </p>
        )}
        <Textarea
          id="diagnostic-conversation"
          aria-describedby="diagnostic-help"
          name="conversation"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setConsent(false);
          }}
          rows={16}
          required
          maxLength={DIAGNOSTIC_TEXT_LIMIT}
          className="min-h-80"
        />
      </div>
      <p className="text-sm text-fg-muted">
        Authorized Timeline staff may review this report to investigate the issue. Reports expire
        after 30 days and are then removed by scheduled cleanup. You can delete yours earlier.
        Backup copies may remain under backup retention. Reports are not sent to LangSmith or used
        to train models. Workspace and sender identifiers and submission times accompany the report.
      </p>
      <label className="flex min-h-11 items-start gap-3 py-2">
        <input
          type="checkbox"
          name="consent"
          checked={consent}
          onChange={(event) => {
            setConsent(event.target.checked);
          }}
          required
          className="mt-1"
        />
        <span>
          I have reviewed this content, am authorized to share it, and agree to share this report
          for troubleshooting.
        </span>
      </label>
      {state.error && <p role="alert">{state.error}</p>}
      <Button type="submit" disabled={pending || !consent || text.length > DIAGNOSTIC_TEXT_LIMIT}>
        {pending ? 'Sending…' : 'Share this report'}
      </Button>
    </form>
  );
}
export function DiagnosticSharingSettings({
  teamId,
  enabled,
}: {
  teamId: string;
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState(configureDiagnosticAction, {});
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
      {state.saved && <p role="status">Sharing preference saved.</p>}
      <Button variant="outline" type="submit" disabled={pending}>
        Save sharing preference
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
