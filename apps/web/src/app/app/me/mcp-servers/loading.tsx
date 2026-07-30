import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function PersonalMcpServersLoading() {
  return (
    <div className="max-w-3xl space-y-8" aria-busy="true" aria-label="Opening personal MCP servers">
      <p role="status" className="sr-only">
        Opening personal MCP servers
      </p>
      <div aria-hidden="true" className="space-y-8">
        <PageHeaderSkeleton />
        <section className="space-y-3">
          <Skeleton className="h-5 w-44" />
          <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </section>
      </div>
    </div>
  );
}
