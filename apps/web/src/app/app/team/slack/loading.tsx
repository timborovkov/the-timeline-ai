import { ChatBindingsSkeleton } from '@/components/integrations/chat-bindings-skeleton';
import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function SlackLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading Slack settings
      </output>
      <h1 className="sr-only">Slack</h1>
      <div
        className="space-y-6 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading Slack settings"
      >
        <div aria-hidden="true" inert className="space-y-6">
          <PageHeaderSkeleton />
          <section className="space-y-4">
            <SlackSetupSkeleton />
            <SlackSetupSkeleton />
            <SlackBindingsSkeleton />
          </section>
        </div>
      </div>
    </>
  );
}

function SlackSetupSkeleton() {
  return (
    <div className="space-y-3 border-y border-border py-4">
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
    <div className="space-y-3 border-y border-border py-4">
      <Skeleton className="h-5 w-44 max-w-full" />
      <ChatBindingsSkeleton />
    </div>
  );
}
