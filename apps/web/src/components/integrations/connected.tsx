'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

interface ConnectedRow {
  id: string;
  provider: string;
  displayName: string;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export function ConnectedIntegrations({ connected }: { connected: ConnectedRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  if (connected.length === 0) {
    return <p className="text-sm text-fg-muted">No integrations connected yet.</p>;
  }

  async function call(method: 'sync' | 'disconnect', id: string) {
    setBusy(`${method}:${id}`);
    try {
      const res = await fetch(`/api/integrations/manage/${id}/${method}`, { method: 'POST' });
      if (!res.ok) {
        const text = await res.text();
        alert(`${method} failed: ${text}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-surface">
      {connected.map((c) => (
        <li key={c.id} className="flex items-center gap-3 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs uppercase tracking-[0.14em] text-fg-muted">
                {c.provider}
              </span>
              <span className="truncate text-sm">{c.displayName}</span>
              {!c.enabled ? (
                <span className="rounded-sm border border-border px-1 text-[10px] uppercase text-fg-muted">
                  Disabled
                </span>
              ) : null}
            </div>
            <div className="text-xs text-fg-muted">
              {c.lastSyncedAt
                ? `Last synced ${new Date(c.lastSyncedAt).toLocaleString()}`
                : 'Never synced'}
              {c.lastError ? <span className="ml-2 text-destructive">· {c.lastError}</span> : null}
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            onClick={() => {
              void call('sync', c.id);
            }}
          >
            {busy === `sync:${c.id}` ? 'Syncing…' : 'Sync now'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => {
              if (confirm('Disconnect this integration?')) {
                void call('disconnect', c.id);
              }
            }}
          >
            Disconnect
          </Button>
        </li>
      ))}
    </ul>
  );
}
