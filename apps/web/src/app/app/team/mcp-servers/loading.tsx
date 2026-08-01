import { Breadcrumb } from '@/components/breadcrumb';
import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function McpServersLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Opening team MCP server settings
      </output>
      <div
        className="space-y-8 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Opening team MCP server settings"
      >
        <h1 className="sr-only">Team MCP servers</h1>
        <Breadcrumb
          items={[
            { label: 'Team', href: '/app/team' },
            { label: 'Integrations', href: '/app/team/integrations' },
            { label: 'Team MCP servers' },
          ]}
        />
        <div className="space-y-8">
          <PageHeaderSkeleton />
          <section aria-label="Team MCP server settings loading placeholder" className="space-y-4">
            <div aria-hidden="true" className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-5 w-44 motion-reduce:animate-none" />
                <Skeleton className="h-8 w-28 motion-reduce:animate-none" />
              </div>
              <div className="space-y-4 rounded-sm border border-border bg-surface p-4">
                <Skeleton className="h-4 w-2/5 motion-reduce:animate-none" />
                <Skeleton className="h-3 w-full motion-reduce:animate-none" />
                <Skeleton className="h-3 w-4/5 motion-reduce:animate-none" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Skeleton className="h-20 w-full motion-reduce:animate-none" />
                  <Skeleton className="h-20 w-full motion-reduce:animate-none" />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
