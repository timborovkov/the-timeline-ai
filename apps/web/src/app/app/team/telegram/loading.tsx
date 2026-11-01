import { ChatBindingsSkeleton } from '@/components/integrations/chat-bindings-skeleton';
import {
  HistoryBackLinkSkeleton,
  PageHeaderSkeleton,
  SettingsSectionSkeleton,
} from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function TelegramLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading Telegram settings
      </output>
      <h1 className="sr-only">Telegram</h1>
      <div
        className="space-y-4 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading Telegram settings"
      >
        <div aria-hidden="true" className="space-y-4">
          <HistoryBackLinkSkeleton />
          <PageHeaderSkeleton variant="collection" />
          <SettingsSectionSkeleton action />
          <SettingsSectionSkeleton action />
          <section className="space-y-2.5 border-t border-border pt-4">
            <Skeleton className="h-5 w-40" />
            <ChatBindingsSkeleton />
          </section>
          <SettingsSectionSkeleton />
        </div>
      </div>
    </>
  );
}
