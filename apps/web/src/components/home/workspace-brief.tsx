import { formatDigestDateTime, type DailyDigestPayload } from '@timeline/shared/messaging/format';
import { Newspaper } from 'lucide-react';
import Link from 'next/link';

import { UpdateReportGroupList } from '@/components/home/update-report-group';

export function WorkspaceBrief({
  digest,
  sourcesNeedAttention = false,
  billingPaused = false,
}: {
  digest: DailyDigestPayload | undefined;
  sourcesNeedAttention?: boolean;
  billingPaused?: boolean;
}) {
  const groups = digest?.update?.groups ?? [];
  const activity = groups.find((group) => group.section === 'activity');
  const upcoming = groups.filter(
    (group) => group.section === 'due' || group.section === 'calendar',
  );

  return (
    <section
      aria-labelledby="workspace-brief-heading"
      className="@container overflow-hidden rounded-md border border-border bg-surface"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border bg-surface-2 px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-sm border border-border-strong bg-bg"
            aria-hidden="true"
          >
            <Newspaper className="size-[18px] text-signal" />
          </span>
          <div>
            <h2
              id="workspace-brief-heading"
              className="text-lg leading-tight font-semibold tracking-tight text-fg"
            >
              Workspace brief
            </h2>
            <p className="mt-1 text-xs text-fg-muted">
              Past 3 days
              {digest && (
                <>
                  {' '}
                  ·{' '}
                  <time dateTime={digest.windowEnd}>
                    {formatDigestDateTime(digest.windowEnd, digest.timezone)}
                  </time>
                </>
              )}
            </p>
          </div>
        </div>
        <Link
          href="/app/updates"
          className="text-sm font-medium text-fg-muted underline decoration-border-strong underline-offset-4 hover:text-fg hover:decoration-signal"
        >
          Manage updates
        </Link>
      </header>
      {billingPaused && (
        <p className="border-b border-border px-4 py-3 text-sm text-fg-muted sm:px-5">
          Workspace AI usage is paused. Updates that need a summary may be delayed.
        </p>
      )}
      {sourcesNeedAttention && (
        <p className="border-b border-border px-4 py-3 text-sm text-fg-muted sm:px-5">
          The brief may be incomplete.{' '}
          <Link href="/app/connections/sources" className="underline underline-offset-4">
            Review source connections
          </Link>
        </p>
      )}
      <div
        className={
          upcoming.length ? '@2xl:grid @2xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]' : undefined
        }
      >
        <div className="px-4 pt-4 pb-1 sm:px-5">
          {activity ? (
            <UpdateReportGroupList group={activity} />
          ) : (
            <p className="pb-3 text-sm leading-relaxed text-fg-muted">
              {digest
                ? 'No notable timeline activity in this window.'
                : 'Recent activity will appear here as your workspace changes.'}
            </p>
          )}
        </div>
        {upcoming.length > 0 && (
          <aside
            aria-label="Coming up"
            className="space-y-4 border-t border-border px-4 pt-4 pb-1 sm:px-5 @2xl:border-t-0 @2xl:border-l"
          >
            {upcoming.map((group) => (
              <UpdateReportGroupList key={group.section} group={group} />
            ))}
          </aside>
        )}
      </div>
      <footer className="border-t border-border px-4 py-3 sm:px-5">
        <Link
          href="/app/timeline"
          className="text-sm font-medium text-fg underline decoration-border-strong underline-offset-4 hover:decoration-signal"
        >
          View timeline
        </Link>
      </footer>
    </section>
  );
}
