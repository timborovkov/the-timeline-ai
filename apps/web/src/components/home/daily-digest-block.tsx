import { formatDigestDate, type DailyDigestPayload } from '@timeline/shared/messaging/format';
import Link from 'next/link';

import { DigestBody } from '@/components/home/digest-body';
import { SectionHeading } from '@/components/section-heading';

export function DailyDigestBlock({ digest }: { digest: DailyDigestPayload | undefined }) {
  if (!digest?.summary) return null;

  return (
    <section
      aria-labelledby="latest-digest-heading"
      className="space-y-3 border-y border-border py-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionHeading id="latest-digest-heading">Latest digest</SectionHeading>
        <div className="flex flex-wrap items-baseline gap-3">
          <time className="font-mono text-xs text-fg-dim">
            {formatDigestDate(digest.windowEnd, digest.timezone)}
          </time>
          <Link href="/app/digests" className="text-xs text-fg-muted hover:text-fg">
            All digests
          </Link>
        </div>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-fg-muted hover:text-fg">
          Open digest
        </summary>
        <DigestBody digest={digest} className="mt-4" />
      </details>
    </section>
  );
}
