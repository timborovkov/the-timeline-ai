import { Breadcrumb } from '@/components/breadcrumb';
import { CollectionRowsSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
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
        <PageHeaderSkeleton />
        <div
          aria-hidden="true"
          className="flex flex-wrap items-center gap-2 border-y border-border py-2"
        >
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-7 w-28 max-w-full motion-reduce:animate-none" />
          ))}
        </div>
        <section aria-label="Team MCP server settings loading placeholder" className="space-y-8">
          <div aria-hidden="true" className="space-y-3">
            <Skeleton className="h-5 w-52 max-w-full motion-reduce:animate-none" />
            <Skeleton className="h-4 w-full max-w-2xl motion-reduce:animate-none" />
            <CollectionRowsSkeleton count={3} />
          </div>
        </section>
      </div>
    </>
  );
}
