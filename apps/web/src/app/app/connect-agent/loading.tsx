import { Breadcrumb } from '@/components/breadcrumb';
import { CollectionRowSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function ConnectAgentLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading Connect your agent
      </output>
      <div
        className="space-y-6 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading Connect your agent"
      >
        <h1 className="sr-only">Connect your agent</h1>
        <Breadcrumb
          items={[
            { label: 'Connections', href: '/app/connections' },
            { label: 'Connect your agent' },
          ]}
        />
        <PageHeaderSkeleton showMetadata={false} />
        <section aria-label="Connect your agent loading placeholder" className="space-y-5">
          <div aria-hidden="true" className="space-y-2">
            <Skeleton className="h-5 w-36 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-full max-w-xl motion-reduce:animate-none" />
          </div>
          <div aria-hidden="true" className="border-t border-border">
            {Array.from({ length: 8 }).map((_, index) => (
              <CollectionRowSkeleton key={index} leading metadata={0} />
            ))}
          </div>
          <div aria-hidden="true" className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex min-h-11 items-center gap-2 py-4">
                <Skeleton className="size-3.5 shrink-0 motion-reduce:animate-none" />
                <Skeleton className="h-4 w-32 motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
