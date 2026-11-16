'use client';

import { formatDigestDate, type DailyDigestPayload } from '@timeline/shared/messaging/format';
import { ChevronDown, Newspaper } from 'lucide-react';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
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
    return (
      <EmptyState
        icon={Newspaper}
        size="inset"
        title="No digests yet"
        body="Daily digests will appear here after Timeline has a window of team activity to summarize."
      />
    );
  }

  return (
    <div>
      <div className="hidden md:grid grid-cols-[8rem_minmax(0,1fr)_6rem] gap-4 border-b border-border text-xs text-fg-dim">
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
            className="group border-b border-border"
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
              className="grid min-h-11 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[8rem_minmax(0,1fr)_6rem] items-center gap-x-4 gap-y-2 py-3 text-sm [&::-webkit-details-marker]:hidden"
            >
              <span className="font-mono text-xs text-fg-dim">
                {formatDigestDate(digest.windowEnd, timezone)}
              </span>
              <span className="col-span-2 row-start-2 min-w-0 text-fg md:col-span-1 md:row-start-auto md:truncate">
                {digest.summary || 'No summary'}
              </span>
              <span
                className={cn(
                  'col-start-2 row-start-1 inline-flex items-center justify-end gap-2 font-mono text-xs capitalize text-fg-dim md:col-start-3',
                  digest.status === 'sent' && 'text-signal',
                )}
              >
                {digest.status}
                <ChevronDown aria-hidden="true" className="size-4 shrink-0 group-open:rotate-180" />
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
