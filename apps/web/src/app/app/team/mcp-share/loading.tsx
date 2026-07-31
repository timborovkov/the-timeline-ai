import { Breadcrumb } from '@/components/breadcrumb';
import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function McpShareLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading Timeline as MCP server
      </output>
      <div
        className="space-y-8 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading Timeline as MCP server"
      >
        <h1 className="sr-only">Timeline as MCP server</h1>
        <Breadcrumb
          items={[
            { label: 'Team', href: '/app/team' },
            { label: 'Integrations', href: '/app/team/integrations' },
            { label: 'Timeline as MCP' },
          ]}
        />
        <PageHeaderSkeleton />
        <section aria-label="Timeline as MCP server loading placeholder" className="space-y-6">
          <div aria-hidden="true" className="grid gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-3 rounded-sm border border-border bg-surface p-3">
                <Skeleton className="h-3 w-16 motion-reduce:animate-none" />
                <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
                <Skeleton className="h-3 w-full motion-reduce:animate-none" />
              </div>
            ))}
          </div>
          <div
            aria-hidden="true"
            data-testid="mcp-endpoint-placeholder"
            className="space-y-3 rounded-sm border border-border bg-surface p-4"
          >
            <Skeleton className="h-5 w-32 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-full max-w-2xl motion-reduce:animate-none" />
            <Skeleton className="h-4 w-full motion-reduce:animate-none" />
            <Skeleton className="h-4 w-5/6 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-full motion-reduce:animate-none" />
            <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-full motion-reduce:animate-none" />
            <Skeleton className="h-8 w-full motion-reduce:animate-none" />
            <Skeleton className="h-3 w-4/5 motion-reduce:animate-none" />
          </div>
          <div aria-hidden="true" className="space-y-3">
            <Skeleton className="h-3 w-28 motion-reduce:animate-none" />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="space-y-3 rounded-sm border border-border bg-surface p-3"
                >
                  <Skeleton className="h-4 w-3/5 motion-reduce:animate-none" />
                  <Skeleton className="h-3 w-full motion-reduce:animate-none" />
                  <Skeleton className="h-3 w-4/5 motion-reduce:animate-none" />
                </div>
              ))}
            </div>
          </div>
          <div aria-hidden="true" className="space-y-3">
            <Skeleton className="h-3 w-28 motion-reduce:animate-none" />
            <div className="grid gap-3 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="space-y-3 rounded-sm border border-border bg-surface p-4"
                >
                  <Skeleton className="h-4 w-2/5 motion-reduce:animate-none" />
                  <Skeleton className="h-3 w-full motion-reduce:animate-none" />
                  <Skeleton className="h-3 w-5/6 motion-reduce:animate-none" />
                  <Skeleton className="h-3 w-4/5 motion-reduce:animate-none" />
                  <Skeleton className="h-64 w-full motion-reduce:animate-none" />
                  <Skeleton className="h-8 w-28 motion-reduce:animate-none" />
                </div>
              ))}
            </div>
          </div>
          <div aria-hidden="true" data-testid="active-keys-placeholder" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-24 motion-reduce:animate-none" />
              <Skeleton className="h-8 w-20 motion-reduce:animate-none" />
            </div>
            <div className="space-y-3 rounded-sm border border-border bg-surface p-4">
              <Skeleton className="h-4 w-2/5 motion-reduce:animate-none" />
              <Skeleton className="h-3 w-3/5 motion-reduce:animate-none" />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
