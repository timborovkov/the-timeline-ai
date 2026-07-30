import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function McpServersLoading() {
  return (
    <div
      className="mx-auto w-full max-w-2xl space-y-6"
      aria-busy="true"
      aria-label="Opening team MCP server settings"
    >
      <p role="status" className="sr-only">
        Opening team MCP server settings
      </p>
      <div aria-hidden="true" className="space-y-6">
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
