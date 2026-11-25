import {
  formatDigestDateTime,
  UPDATE_CHANNEL_LABELS,
  type DailyDigestPayload,
  type DeliveredUpdateChannel,
} from '@timeline/shared/messaging/format';
import { ChevronDown, Newspaper } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';
import { DigestBody } from '@/components/home/digest-body';
import { cn } from '@/lib/utils';

export interface DigestHistoryRow {
  id: string;
  name: string;
  status: string;
  date: string;
  timezone?: string;
  channels: DeliveredUpdateChannel[];
  payload?: DailyDigestPayload;
}

export function DigestHistoryTable({
  digests,
  selectedId,
}: {
  digests: DigestHistoryRow[];
  selectedId?: string;
}) {
  if (digests.length === 0) {
    return (
      <EmptyState
        icon={Newspaper}
        size="inset"
        title="No updates yet"
        body="Your sent updates will appear here after the first delivery."
      />
    );
  }

  return (
    <ol className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
      {digests.map((digest) => {
        const open = digest.id === selectedId && Boolean(digest.payload);
        const date = formatDigestDateTime(digest.date, digest.timezone);
        const channels = digest.channels
          .map((channel) => UPDATE_CHANNEL_LABELS[channel])
          .join(', ');
        return (
          <li key={digest.id} id={`update-${digest.id}`} className="scroll-mt-6">
            <Link
              href={
                open
                  ? '/app/digests'
                  : `/app/digests?digest=${encodeURIComponent(digest.id)}#update-${digest.id}`
              }
              scroll={!open}
              aria-expanded={open}
              className={cn(
                'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-3 hover:bg-surface-2 sm:grid-cols-[minmax(0,1fr)_13rem_8rem_auto] sm:gap-4 sm:px-5',
                open && 'bg-surface-2',
              )}
            >
              <span className="font-medium text-fg [overflow-wrap:anywhere]">{digest.name}</span>
              <time
                dateTime={digest.date}
                className="col-start-1 row-start-2 text-xs text-fg-muted sm:col-start-2 sm:row-start-1"
              >
                {date}
              </time>
              <span className="col-start-2 row-start-2 text-right text-xs text-fg-muted sm:col-start-3 sm:row-start-1 sm:text-left">
                {channels || (digest.status === 'sent' ? 'Sent' : 'In app')}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  'col-start-2 row-start-1 size-4 justify-self-end text-fg-muted sm:col-start-4',
                  open && 'rotate-180',
                )}
              />
            </Link>
            {open && digest.payload && (
              <div className="border-t border-border px-4 py-5 sm:px-5">
                <DigestBody digest={digest.payload} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
