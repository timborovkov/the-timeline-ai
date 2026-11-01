import { ChatBindingsSkeleton } from '@/components/integrations/chat-bindings-skeleton';
import {
  HistoryBackLinkSkeleton,
  PageHeaderSkeleton,
  SettingsSectionSkeleton,
} from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function SlackLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading Slack settings
      </output>
      <h1 className="sr-only">Slack</h1>
      <div
        className="space-y-4 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading Slack settings"
      >
        <div aria-hidden="true" inert className="space-y-4">
          <HistoryBackLinkSkeleton />
          <PageHeaderSkeleton variant="collection" />
          <SettingsSectionSkeleton action />
          <SettingsSectionSkeleton action />
          <SettingsSectionSkeleton lines={1} action />
          <section className="space-y-2.5 border-t border-border pt-4">
            <Skeleton className="h-5 w-44" />
            <ChatBindingsSkeleton />
          </section>
          <SettingsSectionSkeleton />
        </div>
      </div>
    </>
  );
}
