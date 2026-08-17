import { CollectionRowsSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkSubnav } from '@/components/work-subnav';

export default function ApprovalsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading approvals
      </output>
      <div className="space-y-6" aria-busy="true" aria-label="Loading approvals">
        <h1 className="sr-only">Approvals</h1>
        <div aria-hidden="true" className="motion-reduce:[&_.animate-pulse]:animate-none">
          <PageHeaderSkeleton variant="collection" />
        </div>
        <WorkSubnav current="/app/approvals" />
        <div aria-hidden="true" className="motion-reduce:[&_.animate-pulse]:animate-none">
          <div className="flex min-h-11 gap-2 border-b border-border px-3 py-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-7 w-16 rounded-sm" />
            ))}
          </div>
          <CollectionRowsSkeleton count={6} />
        </div>
      </div>
    </>
  );
}
