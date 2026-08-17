'use client';

import { formatDigestDate, type DailyDigestPayload } from '@timeline/shared/messaging';
import { Fragment, useEffect, useState } from 'react';

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
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <caption className="sr-only">Daily digests by day</caption>
        <thead>
          <tr className="border-b border-border text-xs text-fg-dim">
            <th className="py-2 pr-4 font-medium">Day</th>
            <th className="py-2 pr-4 font-medium">Summary</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {digests.map((digest) => {
            const open = openId === digest.id;
            const timezone = digest.timezone ?? digest.payload.timezone;
            const toggleOpen = () => {
              setOverride({ forSelectedId: selectedId, openId: open ? null : digest.id });
            };
            return (
              <Fragment key={digest.id}>
                <tr id={digest.id} className="border-b border-border">
                  <td className="whitespace-nowrap py-3 pr-4 align-top">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={`digest-panel-${digest.id}`}
                      className="font-mono text-xs text-fg-dim hover:text-fg"
                      onClick={toggleOpen}
                    >
                      {formatDigestDate(digest.windowEnd, timezone)}
                    </button>
                  </td>
                  <td className="min-w-0 py-3 pr-4 align-top">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={`digest-panel-${digest.id}`}
                      className="block w-full truncate text-left text-fg hover:text-signal"
                      onClick={toggleOpen}
                    >
                      {digest.summary || 'No summary'}
                    </button>
                  </td>
                  <td className="py-3 align-top">
                    <span
                      className={cn(
                        'font-mono text-xs capitalize text-fg-dim',
                        digest.status === 'sent' && 'text-signal',
                      )}
                    >
                      {digest.status}
                    </span>
                  </td>
                </tr>
                {open ? (
                  <tr className="border-b border-border">
                    <td colSpan={3} className="px-1 pb-5 pt-2">
                      <div id={`digest-panel-${digest.id}`}>
                        <DigestBody digest={digest.payload} />
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
