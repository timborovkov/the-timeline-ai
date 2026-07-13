import { CardSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Matches the DocumentDetail layout in Design v2: page header (index
 * strip), header card with title + metadata + actions, and a
 * version-history card. Same shape as objects/[id]/loading.tsx after
 * the PR #23 design reset.
 */
export default function DocumentDetailLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <PageHeaderSkeleton />
      <CardSkeleton />
      <div className="rounded-sm border border-border bg-card p-5">
        <Skeleton className="mb-4 h-3 w-32" />
        <ul className="divide-y divide-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="flex items-center justify-between py-3">
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-7 w-24 rounded-sm" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
