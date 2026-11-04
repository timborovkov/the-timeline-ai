'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useState } from 'react';

import { updateInboundEmailWhitelistAction } from '@/app/actions/teams';
import { AllowedSendersEditor } from '@/components/allowed-senders-editor';
import { CopyButton } from '@/components/copy-button';
import { CopyableTextField } from '@/components/copyable-text-field';
import { Button } from '@/components/ui/button';
import { normalizeAllowedSender } from '@/lib/allowed-senders';
import { networkActionError, readPublicApiError } from '@/lib/client-api-error';
import {
  AGENT_MEMORY_WEBHOOK_NAME,
  ingestWebhookCurlExample,
  ingestWebhookUrl,
} from '@/lib/connect-agent-content';
import { notifyAction } from '@/lib/notify';

export function ConnectAgentMemory({
  origin,
  isAdmin,
  teamEmail,
  currentUserEmail,
  extraSenders,
  agentWebhookConfigured,
}: {
  origin: string;
  isAdmin: boolean;
  teamEmail: string | null;
  currentUserEmail: string;
  extraSenders: string[];
  agentWebhookConfigured: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const webhookConfigured = agentWebhookConfigured || createdUrl !== null;
  const normalizedUserEmail = currentUserEmail ? normalizeAllowedSender(currentUserEmail) : '';
  const shortcutSenders = Array.from(
    new Set([...extraSenders.map(normalizeAllowedSender), normalizedUserEmail].filter(Boolean)),
  );

  async function createWebhook() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await notifyAction({
        id: 'connect-agent:memory-webhook',
        loading: 'Creating agent webhook…',
        success: webhookConfigured ? 'Agent webhook already exists' : 'Agent webhook created',
        error: 'Couldn’t create agent webhook',
        run: async () => {
          try {
            const response = await fetch('/api/team/ingest-webhooks/agent-memory', {
              method: 'POST',
            });
            if (!response.ok) {
              return {
                error: await readPublicApiError(
                  response,
                  'The agent webhook could not be created. Try again.',
                ),
              };
            }
            const data = (await response.json()) as {
              created: boolean;
              plaintext?: string;
            };
            if (data.created && data.plaintext) {
              setCreatedUrl(ingestWebhookUrl(origin, data.plaintext));
            }
            return { ok: true };
          } catch {
            return { error: networkActionError('create the agent webhook') };
          }
        },
      });
      if (!result.error) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-fg-muted">
        Email the team address or POST the agent webhook. Both create cited evidence through the
        existing ingest path. They never write canonical objects or tasks.
      </p>
      <CopyableTextField
        id="connect-agent-team-email"
        label="Team email"
        value={teamEmail}
        emptyLabel="Inbound email is not configured"
        copyLabel="Copy team email"
        description="Forward, CC, or BCC a note to capture it. Members can always send from their account email."
      />
      {isAdmin ? (
        <div className="space-y-5">
          <AllowedSenderShortcut
            extraSenders={extraSenders}
            shortcutSenders={shortcutSenders}
            currentUserEmail={normalizedUserEmail}
          />
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-fg">Agent webhook</h3>
            <p className="text-sm leading-6 text-fg-muted">
              One-click {AGENT_MEMORY_WEBHOOK_NAME} endpoint. GET on the URL returns{' '}
              <code className="font-mono text-xs">ok: true</code> so agents can validate it. The
              secret URL is shown once.
            </p>
            <Button
              type="button"
              size="sm"
              variant={webhookConfigured ? 'outline' : 'default'}
              disabled={busy}
              onClick={() => void createWebhook()}
            >
              {busy
                ? 'Creating webhook…'
                : webhookConfigured
                  ? 'Create again if missing'
                  : 'Create agent webhook'}
            </Button>
            {webhookConfigured && !createdUrl ? (
              <p className="text-xs leading-5 text-fg-dim">
                An agent memory webhook already exists. Rotate it from Connections if you lost the
                URL.
              </p>
            ) : null}
            {createdUrl ? (
              <div className="space-y-3">
                <p className="text-sm text-fg-muted">
                  Webhook URL — copy it now. It is shown once.
                </p>
                <pre
                  translate="no"
                  className="overflow-x-auto whitespace-pre-wrap break-words rounded-sm border border-border bg-surface-2 p-3 font-mono text-xs leading-5 text-fg"
                >
                  <code>{createdUrl}</code>
                </pre>
                <pre
                  translate="no"
                  className="overflow-x-auto whitespace-pre-wrap break-words rounded-sm border border-border bg-surface-2 p-3 font-mono text-xs leading-5 text-fg"
                >
                  <code>{ingestWebhookCurlExample(createdUrl)}</code>
                </pre>
                <div className="flex flex-wrap gap-2">
                  <CopyButton value={createdUrl} label="Copy webhook URL" />
                  <CopyButton value={ingestWebhookCurlExample(createdUrl)} label="Copy curl" />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCreatedUrl(null);
                    }}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-sm leading-6 text-fg-muted">
          Ask a team admin to add extra allowed senders or create the agent webhook.
        </p>
      )}
    </div>
  );
}

function AllowedSenderShortcut({
  extraSenders,
  shortcutSenders,
  currentUserEmail,
}: {
  extraSenders: string[];
  shortcutSenders: string[];
  currentUserEmail: string;
}) {
  const [state, action] = useActionState(updateInboundEmailWhitelistAction, {});
  const alreadyAllowed = Boolean(currentUserEmail) && extraSenders.includes(currentUserEmail);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-fg">Allowed senders</h3>
          <p className="text-sm leading-6 text-fg-muted">
            Add extra addresses as a list. This is not a comma-separated field.
          </p>
        </div>
        {currentUserEmail && !alreadyAllowed ? (
          <form action={action}>
            <input type="hidden" name="enabled" value="on" />
            <input type="hidden" name="senders" value={shortcutSenders.join('\n')} />
            <Button type="submit" size="sm" variant="outline">
              Allow {currentUserEmail}
            </Button>
          </form>
        ) : null}
      </div>
      <form action={action} className="space-y-3">
        <input type="hidden" name="enabled" value="on" />
        <AllowedSendersEditor senders={extraSenders} />
        <Button type="submit" size="sm">
          Save allowed senders
        </Button>
      </form>
      {state.error ? (
        <p className="text-sm text-danger" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p className="text-sm text-fg-muted" role="status">
          Allowed senders updated.
        </p>
      ) : null}
    </div>
  );
}
