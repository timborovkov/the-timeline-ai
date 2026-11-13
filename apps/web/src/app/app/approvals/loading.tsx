import {
  ChipNavSkeleton,
  CollectionGroupSkeleton,
  PageHeaderSkeleton,
} from '@/components/loading-states';

export default function ApprovalsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading approvals
      </output>
      <div
        data-app-width="overview"
        className="space-y-4"
        aria-busy="true"
        aria-label="Loading approvals"
      >
        <h1 className="sr-only">Approvals</h1>
        <div aria-hidden="true" className="motion-reduce:[&_.animate-pulse]:animate-none">
          <PageHeaderSkeleton />
        </div>
        <div>
          <div aria-hidden="true" className="motion-reduce:[&_.animate-pulse]:animate-none">
            <section aria-label="Approvals loading placeholder">
              <div className="border-b border-border bg-bg">
                <div className="flex min-h-11 min-w-0 flex-wrap items-center gap-1.5 px-2 sm:px-3">
                  <ChipNavSkeleton count={4} widths={['w-16', 'w-14', 'w-16', 'w-10']} />
                </div>
              </div>
              <CollectionGroupSkeleton groups={1} rows={5} leading={false} subtitle />
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
