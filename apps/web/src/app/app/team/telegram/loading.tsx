import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function TelegramLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading Telegram settings
      </output>
      <h1 className="sr-only">Telegram</h1>
      <div
        className="space-y-6 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading Telegram settings"
      >
        <div aria-hidden="true" className="space-y-6">
          <PageHeaderSkeleton />
          <section className="space-y-4">
            <TelegramSetupSkeleton />
            <TelegramSetupSkeleton />
            <TelegramListSkeleton />
          </section>
        </div>
      </div>
    </>
  );
}

function TelegramSetupSkeleton() {
  return (
    <div className="space-y-3 rounded-sm border border-border bg-surface p-4 sm:p-5">
      <Skeleton className="h-5 w-44 max-w-full" />
      <Skeleton className="h-4 w-full max-w-xl" />
      <Skeleton className="h-9 w-40 max-w-full" />
    </div>
  );
}

function TelegramListSkeleton() {
  return (
    <div className="space-y-3 rounded-sm border border-border bg-surface p-4 sm:p-5">
      <Skeleton className="h-5 w-48 max-w-full" />
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
