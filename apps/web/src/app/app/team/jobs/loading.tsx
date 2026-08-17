import { Breadcrumb } from '@/components/breadcrumb';
import { JOB_RECOVERY_PAGE_TITLE } from '@/components/job-recovery/jobs-page-header';
import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function JobsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading job recovery
      </output>
      <div className="space-y-8" aria-busy="true" aria-label="Loading job recovery">
        <h1 className="sr-only">{JOB_RECOVERY_PAGE_TITLE}</h1>
        <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: JOB_RECOVERY_PAGE_TITLE }]} />
        <PageHeaderSkeleton />

        <section
          aria-hidden="true"
          inert
          className="space-y-6 motion-reduce:[&_.animate-pulse]:animate-none"
        >
          <section
            aria-label="Job recovery controls loading placeholder"
            className="flex flex-col gap-2 border-y border-border py-2 md:flex-row md:items-center md:justify-end"
          >
            <div className="flex flex-wrap gap-2 self-start md:self-auto">
              <Skeleton
                data-loading-action="retry"
                className="h-8 w-28 rounded-sm motion-reduce:animate-none"
              />
              <Skeleton
                data-loading-action="dismiss"
                className="h-8 w-32 rounded-sm motion-reduce:animate-none"
              />
            </div>
          </section>
          <div className="overflow-hidden rounded-sm border border-border bg-surface">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="space-y-2 border-b border-border p-3 last:border-b-0">
                <Skeleton className="h-4 w-2/5 motion-reduce:animate-none" />
                <Skeleton className="h-3 w-3/5 motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
