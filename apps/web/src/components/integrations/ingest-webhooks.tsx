'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useReducer } from 'react';

import { useAppDialog } from '@/components/ui/app-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CredentialRow {
  id: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface IngestWebhookRow {
  id: string;
  name: string;
  visibilityDefault: string;
  proposalGenerationEnabled: boolean;
  disabledAt: string | null;
  createdAt: string;
  credentials: CredentialRow[];
}

interface MintedCredential {
  webhookName: string;
  plaintext: string;
}

interface State {
  showCreate: boolean;
  name: string;
  visibilityDefault: 'team' | 'private';
  proposalGenerationEnabled: boolean;
  busy: boolean;
  minted: MintedCredential | null;
  origin: string;
}

type Action =
  | { type: 'showCreate'; showCreate: boolean }
  | { type: 'name'; name: string }
  | { type: 'visibilityDefault'; visibilityDefault: 'team' | 'private' }
  | { type: 'proposalGenerationEnabled'; proposalGenerationEnabled: boolean }
  | { type: 'busy'; busy: boolean }
  | { type: 'minted'; minted: MintedCredential | null }
  | { type: 'origin'; origin: string }
  | { type: 'created'; minted: MintedCredential };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'showCreate':
      return { ...state, showCreate: action.showCreate };
    case 'name':
      return { ...state, name: action.name };
    case 'visibilityDefault':
      return { ...state, visibilityDefault: action.visibilityDefault };
    case 'proposalGenerationEnabled':
      return { ...state, proposalGenerationEnabled: action.proposalGenerationEnabled };
    case 'busy':
      return { ...state, busy: action.busy };
    case 'minted':
      return { ...state, minted: action.minted };
    case 'origin':
      return { ...state, origin: action.origin };
    case 'created':
      return {
        ...state,
        minted: action.minted,
        name: '',
        visibilityDefault: 'team',
        proposalGenerationEnabled: true,
        showCreate: false,
      };
  }
}

function copyToClipboard(text: string): void {
  void navigator.clipboard.writeText(text).catch(() => undefined);
}

export function IngestWebhooksUi({ webhooks }: { webhooks: IngestWebhookRow[] }) {
  const router = useRouter();
  const dialog = useAppDialog();
  const [
    { showCreate, name, visibilityDefault, proposalGenerationEnabled, busy, minted, origin },
    dispatch,
  ] = useReducer(reducer, {
    showCreate: false,
    name: '',
    visibilityDefault: 'team',
    proposalGenerationEnabled: true,
    busy: false,
    minted: null,
    origin: '',
  });

  useEffect(() => {
    dispatch({ type: 'origin', origin: window.location.origin });
  }, []);

  function endpointFor(plaintext: string): string {
    return `${origin || 'https://thetimeline.cc'}/api/webhooks/ingest/${plaintext}`;
  }

  async function create() {
    dispatch({ type: 'busy', busy: true });
    try {
      const res = await fetch('/api/team/ingest-webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, visibilityDefault, proposalGenerationEnabled }),
      });
      if (!res.ok) {
        await dialog.alert({ title: 'Create failed', description: await res.text() });
        return;
      }
      const data = (await res.json()) as { name: string; credential: { plaintext: string } };
      dispatch({
        type: 'created',
        minted: { webhookName: data.name, plaintext: data.credential.plaintext },
      });
      router.refresh();
    } finally {
      dispatch({ type: 'busy', busy: false });
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/team/ingest-webhooks/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    router.refresh();
  }

  async function rotate(id: string, label: string) {
    const confirmed = await dialog.confirm({
      title: 'Rotate credential?',
      description: `"${label}" will get a new URL and the old URL will stop working.`,
      confirmLabel: 'Rotate',
    });
    if (!confirmed) return;
    const res = await fetch(`/api/team/ingest-webhooks/${id}/credentials`, { method: 'POST' });
    if (!res.ok) {
      await dialog.alert({ title: 'Rotate failed', description: await res.text() });
      return;
    }
    const data = (await res.json()) as { plaintext: string };
    dispatch({ type: 'minted', minted: { webhookName: label, plaintext: data.plaintext } });
    router.refresh();
  }

  async function disable(id: string, label: string) {
    const confirmed = await dialog.confirm({
      title: 'Disable webhook?',
      description: `"${label}" will stop accepting new events. Existing timeline evidence stays.`,
      confirmLabel: 'Disable',
      destructive: true,
    });
    if (!confirmed) return;
    await fetch(`/api/team/ingest-webhooks/${id}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-fg-muted">
          Send any textual webhook payload. Timeline stores the payload as evidence and uses AI to
          interpret it.
        </p>
        <Button
          size="sm"
          onClick={() => {
            dispatch({ type: 'showCreate', showCreate: !showCreate });
          }}
        >
          {showCreate ? 'Cancel' : 'New webhook'}
        </Button>
      </div>

      {minted ? (
        <Card className="border-signal/40">
          <CardContent className="space-y-3 pt-4">
            <div>
              <div className="text-sm font-medium">Copy the new URL for {minted.webhookName}</div>
              <p className="text-sm text-fg-muted">
                This is the only time the secret URL is shown.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-sm border border-signal/40 bg-surface-2 px-2 py-1.5 font-mono text-xs">
                {endpointFor(minted.plaintext)}
              </code>
              <Button
                size="sm"
                onClick={() => {
                  copyToClipboard(endpointFor(minted.plaintext));
                }}
              >
                Copy
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                dispatch({ type: 'minted', minted: null });
              }}
            >
              I&apos;ve copied it, dismiss
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {showCreate ? (
        <Card>
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-1">
              <Label htmlFor="ingest-webhook-name">Name</Label>
              <Input
                id="ingest-webhook-name"
                value={name}
                onChange={(e) => {
                  dispatch({ type: 'name', name: e.target.value });
                }}
                placeholder="Pipedrive webhook"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={visibilityDefault === 'team'}
                  onChange={(e) => {
                    dispatch({
                      type: 'visibilityDefault',
                      visibilityDefault: e.target.checked ? 'team' : 'private',
                    });
                  }}
                />
                Team-visible by default
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={proposalGenerationEnabled}
                  onChange={(e) => {
                    dispatch({
                      type: 'proposalGenerationEnabled',
                      proposalGenerationEnabled: e.target.checked,
                    });
                  }}
                />
                Generate approval proposals
              </label>
            </div>
            <Button size="sm" disabled={busy || !name.trim()} onClick={() => void create()}>
              {busy ? 'Creating...' : 'Create webhook'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {webhooks.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border bg-surface p-4 text-sm text-fg-muted">
          No ingest webhooks yet.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-surface">
          {webhooks.map((webhook) => {
            const credential = webhook.credentials[0];
            return (
              <li key={webhook.id} className="space-y-3 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{webhook.name}</div>
                    <div className="font-mono text-xs text-fg-muted">
                      {webhook.disabledAt ? 'disabled' : 'active'} · visibility{' '}
                      {webhook.visibilityDefault} · proposals{' '}
                      {webhook.proposalGenerationEnabled ? 'on' : 'off'}
                      {credential
                        ? ` · ${credential.prefix}... · last used ${
                            credential.lastUsedAt
                              ? new Date(credential.lastUsedAt).toLocaleString()
                              : 'never'
                          }`
                        : ' · no active credential'}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(webhook.disabledAt)}
                      onClick={() => void rotate(webhook.id, webhook.name)}
                    >
                      Rotate
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(webhook.disabledAt)}
                      onClick={() => void disable(webhook.id, webhook.name)}
                    >
                      Disable
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={webhook.visibilityDefault === 'team'}
                      disabled={Boolean(webhook.disabledAt)}
                      onChange={(e) =>
                        void patch(webhook.id, {
                          visibilityDefault: e.target.checked ? 'team' : 'private',
                        })
                      }
                    />
                    Team-visible
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={webhook.proposalGenerationEnabled}
                      disabled={Boolean(webhook.disabledAt)}
                      onChange={(e) =>
                        void patch(webhook.id, {
                          proposalGenerationEnabled: e.target.checked,
                        })
                      }
                    />
                    Proposals
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {dialog.node}
    </div>
  );
}
