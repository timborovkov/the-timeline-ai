import { Breadcrumb } from '@/components/breadcrumb';
import { Skeleton } from '@/components/ui/skeleton';

export default function JobsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading background jobs
      </output>
      <div className="space-y-8" aria-busy="true" aria-label="Loading background jobs">
        <h1 className="sr-only">Background jobs</h1>
        <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Background jobs' }]} />
        <div
          aria-hidden="true"
          className="flex flex-wrap items-center gap-4 border-y border-border py-3"
        >
          <Skeleton className="h-3 w-28 motion-reduce:animate-none" />
          <Skeleton className="h-3 w-24 motion-reduce:animate-none" />
          <Skeleton className="h-3 w-32 motion-reduce:animate-none" />
        </div>

        <section
          aria-hidden="true"
          inert
          className="space-y-8 motion-reduce:[&_.animate-pulse]:animate-none"
        >
          <section aria-labelledby="processing-summary-heading" className="space-y-3">
            <h2 id="processing-summary-heading" className="text-base font-semibold text-fg">
              Processing summary
            </h2>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-fg-dim">Processing activity</p>
                <Skeleton className="h-9 w-24 rounded-sm motion-reduce:animate-none" />
              </div>
              <ul
                aria-busy="true"
                aria-label="Loading job dashboard"
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              >
                {Array.from({ length: 6 }).map((_, index) => (
                  <li
                    key={index}
                    aria-hidden="true"
                    className="rounded-sm border border-border bg-surface p-4"
                  >
                    <Skeleton className="h-3 w-28 motion-reduce:animate-none" />
                    <Skeleton className="mt-3 h-8 w-12 motion-reduce:animate-none" />
                    <Skeleton className="mt-2 h-3 w-32 motion-reduce:animate-none" />
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section aria-labelledby="conversation-suggestions-heading" className="space-y-3">
            <div className="flex flex-col gap-2 rounded-sm border border-border bg-surface p-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <h2 id="conversation-suggestions-heading" className="text-sm font-medium text-fg">
                  Conversation suggestions
                </h2>
                <Skeleton className="h-3 w-64 max-w-full motion-reduce:animate-none" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-8 w-20 rounded-sm motion-reduce:animate-none" />
                <Skeleton className="h-8 w-32 rounded-sm motion-reduce:animate-none" />
              </div>
            </div>
            <section
              aria-label="Job recovery controls loading placeholder"
              className="flex flex-col gap-2 border-y border-border py-2 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 7 }).map((_, index) => (
                  <Skeleton
                    // The live toolbar has seven job-kind filters.
                    key={index}
                    data-loading-filter
                    className="h-7 w-20 rounded-sm motion-reduce:animate-none"
                  />
                ))}
              </div>
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

          <section aria-labelledby="finished-jobs-heading" className="space-y-3 pt-5">
            <div className="border-y border-border py-2">
              <h2 id="finished-jobs-heading" className="text-sm font-semibold text-fg">
                Finished jobs
              </h2>
            </div>
            <div className="overflow-x-auto rounded-sm border border-border bg-surface">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-border text-[11px] text-fg-dim">
                  <tr>
                    {Array.from({ length: 6 }).map((_, index) => (
                      <th key={index} className="px-3 py-2 font-medium">
                        <Skeleton className="h-3 w-16 motion-reduce:animate-none" />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {Array.from({ length: 3 }).map((_, rowIndex) => (
                    <tr key={rowIndex}>
                      {Array.from({ length: 6 }).map((_, columnIndex) => (
                        <td key={columnIndex} className="px-3 py-3">
                          <Skeleton
                            className={
                              columnIndex === 1
                                ? 'h-4 w-3/4 motion-reduce:animate-none'
                                : 'h-4 w-16 motion-reduce:animate-none'
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </div>
    </>
  );
}
