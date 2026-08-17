'use client';

import Image from 'next/image';
import { useState } from 'react';

import type * as integrationsLib from '@timeline/shared/integrations';

import { CollectionRow } from '@/components/collections/collection-row';
import { InlineError } from '@/components/inline-error';
import { Button } from '@/components/ui/button';
import { connectionErrorMessage } from '@/lib/ux-errors';

type CatalogEntry = ReturnType<typeof integrationsLib.listAvailableProviders>[number];

export function IntegrationsCatalog({ catalog }: { catalog: CatalogEntry[] }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string; details: string } | null>(null);

  async function startConnect(id: string) {
    setPending(id);
    setError(null);
    try {
      const res = await fetch(`/api/integrations/${id}/start`, { method: 'POST' });
      if (!res.ok) {
        const text = await res.text();
        setError({ id, message: connectionErrorMessage(text, res.status), details: text });
        return;
      }
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError({
          id,
          message: connectionErrorMessage(data.error, res.status),
          details: data.error ?? 'unknown',
        });
      }
    } finally {
      setPending(null);
    }
  }

  const available = catalog.filter((provider) => provider.available);
  const unavailable = catalog.filter((provider) => !provider.available);
  const pendingProvider = catalog.find((provider) => provider.id === pending);

  if (catalog.length === 0) {
    return (
      <div className="border-y border-border py-6">
        <p className="text-sm font-medium text-fg">No providers are available.</p>
        <p className="mt-1 text-sm text-fg-muted">
          There are no providers ready to connect right now.
        </p>
      </div>
    );
  }

  return (
    <>
      <output className="sr-only" aria-live="polite">
        {pendingProvider ? `Opening ${pendingProvider.label} sign-in` : ''}
      </output>
      <div className="space-y-4" aria-busy={pending !== null}>
        {available.length > 0 ? (
          <div className="border-x border-border">
            {available.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                pending={pending}
                error={error}
                onConnect={startConnect}
              />
            ))}
          </div>
        ) : null}
        {unavailable.length > 0 ? (
          <details open={available.length === 0} className="border-y border-border py-3">
            <summary className="cursor-pointer text-sm font-medium text-fg-muted hover:text-fg">
              {available.length === 0
                ? `Provider setup required · ${String(unavailable.length)}`
                : `More providers · ${String(unavailable.length)}`}
            </summary>
            {available.length === 0 ? (
              <p className="mt-2 text-sm text-fg-muted">
                No providers are ready to connect. These providers need configuration before you can
                connect an account.
              </p>
            ) : null}
            <div className="mt-3 border-x border-border">
              {unavailable.map((provider) => (
                <ProviderRow
                  key={provider.id}
                  provider={provider}
                  pending={pending}
                  error={error}
                  onConnect={startConnect}
                />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </>
  );
}

function ProviderRow({
  provider,
  pending,
  error,
  onConnect,
}: {
  provider: CatalogEntry;
  pending: string | null;
  error: { id: string; message: string; details: string } | null;
  onConnect: (id: string) => Promise<void>;
}) {
  const setupStatusId = `provider-${provider.id}-setup-status`;
  const isPending = pending === provider.id;

  return (
    <div id={provider.id} className="scroll-mt-24">
      <CollectionRow>
        <CollectionRow.Leading>
          <Image
            src={provider.logo}
            alt=""
            width={28}
            height={28}
            className="size-7 rounded-sm bg-surface-2 p-1"
          />
        </CollectionRow.Leading>
        <CollectionRow.Title>{provider.label}</CollectionRow.Title>
        <CollectionRow.Context>{provider.description}</CollectionRow.Context>
        <CollectionRow.Metadata>
          {!provider.available ? (
            <span className="text-[11px] text-fg-dim">Setup required</span>
          ) : (
            <span className="text-[11px] text-fg-dim">Personal account first</span>
          )}
        </CollectionRow.Metadata>
        <CollectionRow.Actions>
          <Button
            size="sm"
            variant={provider.available ? 'default' : 'outline'}
            aria-busy={isPending || undefined}
            aria-describedby={!provider.available ? setupStatusId : undefined}
            disabled={!provider.available || pending !== null}
            onClick={() => void onConnect(provider.id)}
          >
            {isPending ? 'Opening sign-in…' : 'Connect account'}
          </Button>
        </CollectionRow.Actions>
      </CollectionRow>
      {error?.id === provider.id ? (
        <div className="px-3 pb-3">
          <InlineError
            message={error.message}
            details={error.details}
            onRetry={() => void onConnect(provider.id)}
            retrying={pending === provider.id}
          />
        </div>
      ) : null}
      {!provider.available ? (
        <p id={setupStatusId} className="px-3 pb-3 text-xs text-fg-muted">
          Provider setup is required before you can connect this account.
        </p>
      ) : null}
    </div>
  );
}
