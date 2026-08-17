'use client';

import Image from 'next/image';
import { useState } from 'react';

import type * as integrationsLib from '@timeline/shared/integrations';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { notifyAction } from '@/lib/notify';
import { connectionErrorMessage } from '@/lib/ux-errors';

type CatalogEntry = ReturnType<typeof integrationsLib.listAvailableProviders>[number];

export function IntegrationsCatalog({ catalog }: { catalog: CatalogEntry[] }) {
  const [pending, setPending] = useState<string | null>(null);

  async function startConnect(id: string) {
    setPending(id);
    await notifyAction({
      id: `integration:connect:${id}`,
      loading: 'Opening sign-in…',
      success: 'Opening sign-in',
      error: 'Couldn’t start connection',
      run: async () => {
        const res = await fetch(`/api/integrations/${id}/start`, { method: 'POST' });
        if (!res.ok) {
          const text = await res.text();
          return { error: connectionErrorMessage(text, res.status) };
        }
        const data = (await res.json()) as { url?: string; error?: string };
        if (data.url) {
          window.location.href = data.url;
          return { ok: true };
        }
        return { error: connectionErrorMessage(data.error, res.status) };
      },
    });
    setPending(null);
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
      <div className="space-y-3" aria-busy={pending !== null}>
        {available.length > 0 ? (
          <div className="grid auto-rows-fr gap-3 md:grid-cols-2">
            {available.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                pending={pending}
                onConnect={startConnect}
              />
            ))}
          </div>
        ) : null}
        {unavailable.length > 0 ? (
          <details
            open={available.length === 0}
            className="rounded-lg border border-border bg-surface p-4"
          >
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
            <div className="mt-4 grid auto-rows-fr gap-3 border-t border-border pt-4 md:grid-cols-2">
              {unavailable.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  pending={pending}
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

function ProviderCard({
  provider,
  pending,
  onConnect,
}: {
  provider: CatalogEntry;
  pending: string | null;
  onConnect: (id: string) => Promise<void>;
}) {
  const setupStatusId = `provider-${provider.id}-setup-status`;
  const isPending = pending === provider.id;

  return (
    <Card id={provider.id} className="flex h-full scroll-mt-24 flex-col">
      <CardHeader className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
        <Image
          src={provider.logo}
          alt=""
          width={28}
          height={28}
          className="size-7 rounded-sm bg-surface-2 p-1"
        />
        <CardTitle className="text-sm font-medium">{provider.label}</CardTitle>
        {!provider.available ? (
          <p
            id={setupStatusId}
            className="text-xs text-fg-muted sm:ml-auto sm:max-w-48 sm:text-right"
          >
            Provider setup is required before you can connect this account.
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <p className="text-sm text-fg-muted">{provider.description}</p>
        <p className="mt-2 text-xs text-fg-muted">
          Creates a personal provider account first. Team sync is activated after sources are
          shared.
        </p>
        <div className="mt-auto pt-3">
          <Button
            size="sm"
            aria-busy={isPending || undefined}
            aria-describedby={!provider.available ? setupStatusId : undefined}
            disabled={!provider.available || pending !== null}
            onClick={() => void onConnect(provider.id)}
          >
            {isPending ? 'Opening sign-in…' : 'Connect account'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
