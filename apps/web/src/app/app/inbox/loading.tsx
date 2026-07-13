import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function InboxLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <PageHeaderSkeleton />
      <nav className="flex gap-1.5" aria-label="Loading inbox filters">
        <Skeleton className="h-6 w-12 rounded-sm" />
        <Skeleton className="h-6 w-16 rounded-sm" />
      </nav>
      <ul className="border-t border-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <li
            key={i}
            className="grid grid-cols-[18ch_1fr] gap-x-4 gap-y-1 border-b border-border py-3"
          >
            <Skeleton className="h-3 w-[16ch]" />
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
