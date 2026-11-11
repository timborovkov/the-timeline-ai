'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useReducer, useRef, useState, type SyntheticEvent } from 'react';

import { McpOutboundKeyForm } from '@/components/connect-agent/mcp-outbound-key-form';
import {
  McpOutboundKeyList,
  type ConnectAgentKey,
} from '@/components/connect-agent/mcp-outbound-key-list';
import { CopyButton } from '@/components/copy-button';
import { useAppDialog } from '@/components/ui/app-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { networkActionError, readPublicApiError } from '@/lib/client-api-error';
import { oauthCommand, remoteJsonConfig } from '@/lib/connect-agent-content';
import { notifyAction } from '@/lib/notify';

export type { ConnectAgentKey };

interface AdvancedState {
  showCreate: boolean;
  name: string;
  nameError: string | null;
  allowCapture: boolean;
  allowAgent: boolean;
  allowWebsiteScan: boolean;
  allowWebsiteManage: boolean;
  busy: boolean;
  mintedKey: { name: string; plaintext: string } | null;
}

function patchState(state: AdvancedState, patch: Partial<AdvancedState>): AdvancedState {
  return { ...state, ...patch };
}

export function ConnectAgentAdvanced({
  keys,
  mcpUrl,
  isAdmin,
}: {
  keys: ConnectAgentKey[];
  mcpUrl: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const dialog = useAppDialog();
  const keyNameId = useId();
  const keyNameErrorId = useId();
  const jsonId = useId();
  const keyNameRef = useRef<HTMLInputElement>(null);
  const focusNameOnError = useRef(false);
  const busyKeyIds = useRef<Set<string> | null>(null);
  const [keyMutations, setKeyMutations] = useState<Record<string, { busy: boolean }>>({});
  const [
    {
      showCreate,
      name,
      nameError,
      allowCapture,
      allowAgent,
      allowWebsiteScan,
      allowWebsiteManage,
      busy,
      mintedKey,
    },
    update,
  ] = useReducer(patchState, {
    showCreate: false,
    name: '',
    nameError: null,
    allowCapture: true,
    allowAgent: false,
    allowWebsiteScan: false,
    allowWebsiteManage: false,
    busy: false,
    mintedKey: null,
  });

  function activeBusyKeyIds(): Set<string> {
    busyKeyIds.current ??= new Set();
    return busyKeyIds.current;
  }

  useEffect(() => {
    if (!nameError || !focusNameOnError.current) return;
    keyNameRef.current?.focus();
    focusNameOnError.current = false;
  }, [nameError]);

  const jsonSnippet = remoteJsonConfig(mcpUrl, mintedKey?.plaintext);
  const oauthSnippet = oauthCommand(mcpUrl);

  function submitCreate(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      focusNameOnError.current = true;
      update({ nameError: 'Enter a label for this key.' });
      return;
    }
    void create();
  }

  async function create() {
    update({ busy: true });
    try {
      const result = await notifyAction({
        id: 'connect-agent:create-key',
        loading: 'Creating key…',
        success: 'Key created',
        error: 'Couldn’t create key',
        run: async () => {
          try {
            const res = await fetch('/api/team/mcp-keys', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                name,
                allowCapture,
                allowAgent,
                allowWebsiteScan,
                allowWebsiteManage,
              }),
            });
            if (!res.ok) {
              return {
                error: await readPublicApiError(res, 'The key could not be created. Try again.'),
              };
            }
            const data = (await res.json()) as { name: string; plaintext: string };
            update({
              mintedKey: { name: data.name, plaintext: data.plaintext },
              name: '',
              allowCapture: true,
              allowAgent: false,
              allowWebsiteScan: false,
              allowWebsiteManage: false,
              showCreate: false,
            });
            return { ok: true };
          } catch {
            return { error: networkActionError('create this key') };
          }
        },
      });
      if (!result.error) router.refresh();
    } finally {
      update({ busy: false });
    }
  }

  async function revoke(id: string, label: string) {
    if (activeBusyKeyIds().has(id)) return;
    const confirmed = await dialog.confirm({
      title: 'Revoke key?',
      description: `"${label}" will stop working for any agent using it.`,
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (!confirmed) return;
    if (activeBusyKeyIds().has(id)) return;
    activeBusyKeyIds().add(id);
    setKeyMutations((current) => ({ ...current, [id]: { busy: true } }));
    try {
      const result = await notifyAction({
        id: `connect-agent-key:${id}:revoke`,
        loading: 'Revoking key…',
        success: 'Key revoked',
        error: 'Couldn’t revoke key',
        run: async () => {
          try {
            const response = await fetch(`/api/team/mcp-keys/${id}`, { method: 'DELETE' });
            if (!response.ok) {
              return {
                error: await readPublicApiError(
                  response,
                  'The key could not be revoked. Try again.',
                ),
              };
            }
            return { ok: true };
          } catch {
            return { error: networkActionError('revoke this key') };
          }
        },
      });
      if (!result.error) router.refresh();
    } finally {
      activeBusyKeyIds().delete(id);
      setKeyMutations((current) => ({ ...current, [id]: { busy: false } }));
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-6 text-fg-muted">
        Static <span className="font-mono">tla_</span> keys are a fallback for clients that cannot
        complete OAuth. They are team-visible only. Static-key remember is authored as the team
        actor, not a member. Prefer OAuth.
      </p>
      <div className="space-y-2">
        <Label htmlFor={jsonId} size="sm">
          JSON config
        </Label>
        <pre
          id={jsonId}
          translate="no"
          className="overflow-x-auto whitespace-pre-wrap break-words rounded-sm border border-border bg-surface-2 p-3 font-mono text-xs leading-5 text-fg"
        >
          <code>{jsonSnippet}</code>
        </pre>
        {mintedKey ? (
          <CopyButton value={jsonSnippet} label="Copy JSON" />
        ) : (
          <p className="text-xs leading-5 text-fg-dim">
            Create a key to fill the Authorization header. Direct Codex OAuth:{' '}
            <code className="font-mono">{oauthSnippet}</code>
          </p>
        )}
      </div>
      {isAdmin ? (
        <>
          {mintedKey ? (
            <div className="space-y-3">
              <div className="text-sm font-medium">
                New key: keep this open until your client is connected
              </div>
              <p className="text-sm text-fg-muted">
                The plaintext for <span className="font-mono">{mintedKey.name}</span> is shown below
                once. We store only the hash.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-sm border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs">
                  {mintedKey.plaintext}
                </code>
                <CopyButton value={mintedKey.plaintext} />
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  update({ mintedKey: null });
                }}
              >
                Connected — dismiss key
              </Button>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <div className="text-xs text-fg-muted">Active keys ({keys.length})</div>
            <Button
              size="sm"
              variant={showCreate ? 'ghost' : 'default'}
              onClick={() => {
                update({ showCreate: !showCreate, nameError: null });
              }}
            >
              {showCreate ? 'Cancel' : 'New key'}
            </Button>
          </div>
          {showCreate ? (
            <McpOutboundKeyForm
              keyNameId={keyNameId}
              keyNameErrorId={keyNameErrorId}
              keyNameRef={keyNameRef}
              name={name}
              nameError={nameError}
              allowCapture={allowCapture}
              allowAgent={allowAgent}
              allowWebsiteScan={allowWebsiteScan}
              allowWebsiteManage={allowWebsiteManage}
              onAllowWebsiteScanChange={(value) => {
                update({
                  allowWebsiteScan: value,
                  ...(!value ? { allowWebsiteManage: false } : {}),
                });
              }}
              onAllowWebsiteManageChange={(value) => {
                update({ allowWebsiteManage: value, ...(value ? { allowWebsiteScan: true } : {}) });
              }}
              busy={busy}
              allowAgentDescription="This key can start paid agent turns. Remember from a static key is still authored as the team actor."
              onNameChange={(value) => {
                update({ name: value, nameError: null });
              }}
              onAllowCaptureChange={(value) => {
                update({ allowCapture: value });
              }}
              onAllowAgentChange={(value) => {
                update({ allowAgent: value });
              }}
              onSubmit={submitCreate}
            />
          ) : null}
          <McpOutboundKeyList keys={keys} keyMutations={keyMutations} onRevoke={revoke} />
        </>
      ) : (
        <p className="text-sm text-fg-muted">Ask a team admin to mint a static key.</p>
      )}
      {dialog.node}
    </div>
  );
}
