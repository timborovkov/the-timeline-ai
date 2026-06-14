'use client';

import Image from 'next/image';
import { useState } from 'react';

import type * as integrationsLib from '@timeline/shared/integrations';

import { useAppDialog } from '@/components/ui/app-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type CatalogEntry = ReturnType<typeof integrationsLib.listAvailableProviders>[number];

export function IntegrationsCatalog({ catalog }: { catalog: CatalogEntry[] }) {
  const [pending, setPending] = useState<string | null>(null);
  const dialog = useAppDialog();

  async function startConnect(id: string) {
    setPending(id);
    try {
      const res = await fetch(`/api/integrations/${id}/start`, { method: 'POST' });
      if (!res.ok) {
        const text = await res.text();
        await dialog.alert({ title: 'Connect failed', description: text });
        return;
      }
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        await dialog.alert({ title: 'Connect failed', description: data.error ?? 'unknown' });
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <div className="grid auto-rows-fr gap-3 md:grid-cols-2">
        {catalog.map((c) => (
          <Card key={c.id} id={c.id} className="flex h-full scroll-mt-24 flex-col">
            <CardHeader className="flex flex-row items-center gap-3">
              <Image
                src={c.logo}
                alt=""
                width={28}
                height={28}
                className="size-7 rounded-sm bg-surface-2 p-1"
              />
              <CardTitle className="text-sm font-medium">{c.label}</CardTitle>
              {!c.available ? (
                <span className="ml-auto rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase text-fg-muted">
                  Not configured
                </span>
              ) : null}
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              <p className="text-sm text-fg-muted">{c.description}</p>
              <div className="mt-auto pt-3">
                <Button
                  size="sm"
                  disabled={!c.available || pending === c.id}
                  onClick={() => {
                    void startConnect(c.id);
                  }}
                >
                  {pending === c.id ? 'Redirecting…' : 'Connect'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {dialog.node}
    </>
  );
}
