'use client';
import type * as boards from '@timeline/shared/boards';
import { nativeProviderLabel } from '@timeline/shared/integrations/provider-labels';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { SYNCED_STATUS_LABEL } from '@/lib/task-statuses';

export function ImportSourceControl({
  source,
  references = [],
}: {
  source: NonNullable<boards.BoardItemRow['importSource']> | 'locked';
  references?: NonNullable<boards.BoardItemRow['importReferences']>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  if (source === 'locked') return <p>{SYNCED_STATUS_LABEL}</p>;
  const provider = nativeProviderLabel(source.provider);
  const field =
    source.field === 'lane' ? 'stage' : source.field === 'status' ? 'status' : 'source link';
  const label =
    source.state === 'paused'
      ? 'Source sync paused'
      : source.field === 'reference'
        ? 'Imported from ' + provider
        : field === 'stage'
          ? 'Stage synced from HubSpot'
          : 'Status synced from ' + provider;
  return (
    <section className="space-y-1 border-b border-border px-3 py-2 text-sm">
      <p>{label}</p>
      <div className="flex flex-wrap gap-3">
        {source.url && (
          <a href={source.url} target="_blank" rel="noreferrer" className="underline">
            Open in {provider}
          </a>
        )}
        {references.map((ref) =>
          ref.url ? (
            <a key={ref.id} href={ref.url} target="_blank" rel="noreferrer" className="underline">
              {referenceLabel(ref.url)}
            </a>
          ) : null,
        )}
        {source.canManage && (
          <button
            type="button"
            className="underline"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                try {
                  const response = await fetch('/api/team/board-imports', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ action: 'unlink', id: source.id }),
                  });
                  if (!response.ok) throw new Error();
                  router.refresh();
                } catch {
                  setError('Could not stop syncing. Try again.');
                }
              });
            }}
          >
            Stop syncing {field}
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function referenceLabel(url: string) {
  if (url.startsWith('https://app.hubspot.com/')) return 'Open linked deal in HubSpot';
  const number = url.split('/').at(-1) ?? '';
  return url.includes('/pull/') ? 'Linked pull request #' + number : 'Linked issue #' + number;
}
