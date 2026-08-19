'use client';

import { formatDigestDate, type DailyDigestPayload } from '@timeline/shared/messaging/format';
import { useEffect, useState } from 'react';

import { DigestBody } from '@/components/home/digest-body';
import { cn } from '@/lib/utils';

export interface DigestHistoryRow {
  id: string;
  status: string;
  summary: string;
  windowEnd: string;
  timezone?: string;
  payload: DailyDigestPayload;
}

export function DigestHistoryTable({
  digests,
  selectedId,
}: {
  digests: DigestHistoryRow[];
  selectedId?: string;
}) {
  const [override, setOverride] = useState<{
    forSelectedId: string | undefined;
    openId: string | null;
  } | null>(null);
  const openId =
    override && override.forSelectedId === selectedId ? override.openId : (selectedId ?? null);

  useEffect(() => {
    if (!selectedId) return;
    document.getElementById(selectedId)?.scrollIntoView({ block: 'start' });
  }, [selectedId]);

  if (digests.length === 0) {
    return <p className="text-sm text-fg-muted">No digests have been generated yet.</p>;
  }

  return (
    <div>
      <div className="grid grid-cols-[8rem_minmax(0,1fr)_6rem] gap-4 border-b border-border text-xs text-fg-dim">
        <div className="py-2 font-medium">Day</div>
        <div className="py-2 font-medium">Summary</div>
        <div className="py-2 font-medium">Status</div>
      </div>
      {digests.map((digest) => {
        const open = openId === digest.id;
        const timezone = digest.timezone ?? digest.payload.timezone;
        return (
          <details
            key={digest.id}
            id={digest.id}
            className="border-b border-border"
            open={open || undefined}
            onToggle={(event) => {
              const nextOpen = event.currentTarget.open;
              setOverride({
                forSelectedId: selectedId,
                openId: nextOpen ? digest.id : null,
              });
            }}
          >
            <summary
              aria-expanded={open}
              className="grid min-h-11 cursor-pointer grid-cols-[8rem_minmax(0,1fr)_6rem] items-center gap-4 py-2 text-sm"
            >
              <span className="font-mono text-xs text-fg-dim">
                {formatDigestDate(digest.windowEnd, timezone)}
              </span>
              <span className="min-w-0 truncate text-fg">{digest.summary || 'No summary'}</span>
              <span
                className={cn(
                  'font-mono text-xs capitalize text-fg-dim',
                  digest.status === 'sent' && 'text-signal',
                )}
              >
                {digest.status}
              </span>
            </summary>
            <div id={`digest-panel-${digest.id}`} className="px-1 pb-5 pt-1">
              <DigestBody digest={digest.payload} />
            </div>
          </details>
        );
      })}
    </div>
  );
}
