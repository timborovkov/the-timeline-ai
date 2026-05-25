import { CardSkeleton } from '@/components/loading-states';
import { NarrowContainer } from '@/components/narrow-container';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Matches the DocumentDetail layout: back link, header card with title +
 * metadata + action buttons, and a version-history card with a list of
 * versions. Same shape as objects/[id]/loading.tsx — established by
 * PR #20.
 */
export default function DocumentDetailLoading() {
  return (
    <NarrowContainer>
      <div className="space-y-6">
        <Skeleton className="h-4 w-40" />
        <CardSkeleton />
        <div className="rounded-xl border bg-card p-6">
          <Skeleton className="mb-4 h-4 w-32" />
          <ul className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="flex items-center justify-between py-3">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-7 w-24 rounded-md" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </NarrowContainer>
  );
}
