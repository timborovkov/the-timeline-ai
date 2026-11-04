import { Breadcrumb } from '@/components/breadcrumb';
import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function ConnectAgentLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading Connect your agent
      </output>
      <div
        className="space-y-8 motion-reduce:[&_.animate-pulse]:animate-none"
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
        <PageHeaderSkeleton />
        <section aria-label="Connect your agent loading placeholder" className="space-y-6">
          <div aria-hidden="true" className="space-y-3 border-y border-border py-4">
            <Skeleton className="h-5 w-40 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-full max-w-2xl motion-reduce:animate-none" />
            <Skeleton className="h-16 w-full motion-reduce:animate-none" />
          </div>
          <div
            aria-hidden="true"
            className="flex min-w-0 gap-2 overflow-hidden border-b border-border pb-2"
          >
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-28 shrink-0 motion-reduce:animate-none" />
            ))}
          </div>
          <div aria-hidden="true" className="space-y-3">
            <Skeleton className="h-5 w-36 motion-reduce:animate-none" />
            <Skeleton className="h-16 w-full motion-reduce:animate-none" />
            <Skeleton className="h-16 w-full motion-reduce:animate-none" />
          </div>
        </section>
      </div>
    </>
  );
}
