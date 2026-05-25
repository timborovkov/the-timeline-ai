'use client';

import { useState } from 'react';

import type { integrations as integrationsLib } from '@timeline/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type CatalogEntry = ReturnType<typeof integrationsLib.listAvailableProviders>[number];

export function IntegrationsCatalog({ catalog }: { catalog: CatalogEntry[] }) {
  const [pending, setPending] = useState<string | null>(null);

  async function startConnect(id: string) {
    setPending(id);
    try {
      const res = await fetch(`/api/integrations/${id}/start`, { method: 'POST' });
      if (!res.ok) {
        const text = await res.text();
        alert(`Connect failed: ${text}`);
        return;
      }
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(`Connect failed: ${data.error ?? 'unknown'}`);
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {catalog.map((c) => (
        <Card key={c.id}>
          <CardHeader className="flex flex-row items-center gap-3">
            {/* Logo via /public/connectors/<id>.svg. Falls back gracefully if missing. */}
            <img
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
          <CardContent className="space-y-3">
            <p className="text-sm text-fg-muted">{c.description}</p>
            <Button
              size="sm"
              disabled={!c.available || pending === c.id}
              onClick={() => {
                void startConnect(c.id);
              }}
            >
              {pending === c.id ? 'Redirecting…' : 'Connect'}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
