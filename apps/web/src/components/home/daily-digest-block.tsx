import {
  digestSummaryParagraphs,
  type DailyDigestPayload,
} from '@timeline/shared/messaging/format';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { DigestBody } from '@/components/home/digest-body';
import { UpdateFollowUp } from '@/components/home/update-follow-up';
import { RegionalDate } from '@/components/regional-date';
import { SectionHeading } from '@/components/section-heading';

export function DailyDigestBlock({ children }: { children: ReactNode }) {
  return (
    <section
      aria-labelledby="latest-digest-heading"
      className="space-y-4 border-t border-border py-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionHeading id="latest-digest-heading">Updates</SectionHeading>
        <div className="flex flex-wrap items-baseline gap-3">
          <Link href="/app/updates" className="text-sm font-medium underline underline-offset-4">
            Customize updates
          </Link>
          <Link href="/app/digests" className="text-xs text-fg-muted hover:text-fg">
            Update history
          </Link>
        </div>
      </div>
      {children}
    </section>
  );
}

export function DailyDigestContent({
  digest,
  digestId,
  paused = false,
  sourcesNeedAttention = false,
  billingPaused = false,
}: {
  digest: DailyDigestPayload | undefined;
  digestId?: string;
  paused?: boolean;
  sourcesNeedAttention?: boolean;
  billingPaused?: boolean;
}) {
  return (
    <>
      {digest ? (
        <p className="font-mono text-xs text-fg-dim">
          <RegionalDate value={digest.windowEnd} />
        </p>
      ) : null}
      {paused ? <p className="text-sm text-fg-muted">Scheduled updates are paused.</p> : null}
      {billingPaused && !paused ? (
        <p className="text-sm text-fg-muted">
          Workspace AI usage is paused. Updates that need a summary may be delayed.
        </p>
      ) : null}
      {sourcesNeedAttention && !paused ? (
        <p className="text-sm text-fg-muted">
          Updates may be incomplete.{' '}
          <Link href="/app/connections/sources" className="underline underline-offset-4">
            Review source connections
          </Link>
        </p>
      ) : null}
      {digest?.summary ? (
        <>
          <p className="max-w-3xl text-base leading-7 text-fg-muted line-clamp-3">
            {digestSummaryParagraphs(digest.summary)[0]}
          </p>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-fg-muted hover:text-fg">
              Open update
            </summary>
            <DigestBody digest={digest} className="mt-4" />
          </details>
          {digestId ? <UpdateFollowUp digestId={digestId} /> : null}
        </>
      ) : !paused && !sourcesNeedAttention && !billingPaused ? (
        <p className="text-sm text-fg-muted">Your scheduled updates will appear here.</p>
      ) : null}
    </>
  );
}
