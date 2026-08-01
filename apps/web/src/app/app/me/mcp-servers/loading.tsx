import { Breadcrumb } from '@/components/breadcrumb';
import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function PersonalMcpServersLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Opening personal MCP servers
      </output>
      <div
        className="max-w-3xl space-y-8"
        aria-busy="true"
        aria-label="Opening personal MCP servers"
      >
        <h1 className="sr-only">Personal MCP servers</h1>
        <Breadcrumb
          items={[
            { label: 'Connections', href: '/app/sources' },
            { label: 'Personal MCP servers' },
          ]}
        />
        <div aria-hidden="true" className="space-y-8">
          <PageHeaderSkeleton />
          <section className="space-y-3">
            <Skeleton className="h-5 w-44" />
            <div className="space-y-3 rounded-sm border border-border bg-surface p-4">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
