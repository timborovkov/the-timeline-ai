import { HistoryBackLink } from '@/components/history-back-link';
import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function SlackLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading Slack settings
      </output>
      <div className="space-y-6" aria-busy="true" aria-label="Loading Slack settings">
        <HistoryBackLink fallbackHref="/app/team" label="Team settings" />
        <h1 className="sr-only">Slack</h1>
        <PageHeaderSkeleton />
        <section aria-label="Slack settings loading placeholder" className="space-y-4">
          <SlackSetupSkeleton />
          <SlackSetupSkeleton />
          <SlackBindingsSkeleton />
        </section>
      </div>
    </>
  );
}

function SlackSetupSkeleton() {
  return (
    <div className="space-y-3 rounded-sm border border-border bg-surface p-4 sm:p-5">
      <Skeleton className="h-5 w-40 max-w-full" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-full max-w-xl" />
          <Skeleton className="h-3 w-2/3 max-w-full" />
        </div>
        <Skeleton className="h-9 w-32 shrink-0" />
      </div>
    </div>
  );
}

function SlackBindingsSkeleton() {
  return (
    <div className="space-y-3 rounded-sm border border-border bg-surface p-4 sm:p-5">
      <Skeleton className="h-5 w-44 max-w-full" />
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-36 max-w-full" />
              <Skeleton className="h-3 w-3/4 max-w-full" />
            </div>
            <Skeleton className="h-8 w-20 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
