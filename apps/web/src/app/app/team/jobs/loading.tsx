import { Breadcrumb } from '@/components/breadcrumb';
import { JOB_RECOVERY_PAGE_TITLE } from '@/components/job-recovery/jobs-attention';
import {
  ChipNavSkeleton,
  CollectionGroupSkeleton,
  PageHeaderSkeleton,
} from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function JobsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading job recovery
      </output>
      <div className="space-y-8" aria-busy="true" aria-label="Loading job recovery">
        <h1 className="sr-only">{JOB_RECOVERY_PAGE_TITLE}</h1>
        <Breadcrumb
          items={[{ label: 'Team', href: '/app/team' }, { label: JOB_RECOVERY_PAGE_TITLE }]}
        />
        <PageHeaderSkeleton showMetadata={false} />

        <section
          aria-hidden="true"
          inert
          className="space-y-4 motion-reduce:[&_.animate-pulse]:animate-none"
        >
          <section
            aria-label="Job recovery controls loading placeholder"
            className="flex flex-col gap-2 border-y border-border py-2 md:flex-row md:items-center md:justify-between"
          >
            <ChipNavSkeleton count={4} widths={['w-10', 'w-16', 'w-20', 'w-16']} />
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
          <CollectionGroupSkeleton groups={1} rows={3} leading={false} subtitle />
          <CollectionGroupSkeleton groups={1} rows={2} leading={false} subtitle />
        </section>
      </div>
    </>
  );
}
