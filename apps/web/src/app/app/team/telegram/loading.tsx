import { ChatBindingsSkeleton } from '@/components/integrations/chat-bindings-skeleton';
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
    <div className="space-y-3 border-y border-border py-4">
      <Skeleton className="h-5 w-44 max-w-full" />
      <Skeleton className="h-4 w-full max-w-xl" />
      <Skeleton className="h-9 w-40 max-w-full" />
    </div>
  );
}

function TelegramListSkeleton() {
  return (
    <div className="space-y-3 border-y border-border py-4">
      <Skeleton className="h-5 w-48 max-w-full" />
      <ChatBindingsSkeleton />
    </div>
  );
}
