import { Breadcrumb } from '@/components/breadcrumb';
import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function McpShareLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Opening Connect your agent
      </output>
      <div
        className="space-y-8 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Opening Connect your agent"
      >
        <h1 className="sr-only">Timeline as MCP server</h1>
        <Breadcrumb
          items={[
            { label: 'Team', href: '/app/team' },
            { label: 'Connections', href: '/app/connections' },
            { label: 'Timeline as MCP' },
          ]}
        />
        <PageHeaderSkeleton />
        <section aria-label="Timeline as MCP server loading placeholder" className="space-y-6">
          <Skeleton className="h-5 w-48 motion-reduce:animate-none" />
          <Skeleton className="h-4 w-full max-w-2xl motion-reduce:animate-none" />
          <Skeleton className="h-24 w-full motion-reduce:animate-none" />
        </section>
      </div>
    </>
  );
}
