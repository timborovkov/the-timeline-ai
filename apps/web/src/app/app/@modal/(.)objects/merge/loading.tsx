import { ObjectMergeRouteModalFrame } from '@/components/objects/object-merge-route-modal';
import { Skeleton } from '@/components/ui/skeleton';

export default function MergeObjectModalLoading() {
  return (
    <ObjectMergeRouteModalFrame
      title="Review merge"
      description="Choose the object to keep, then merge the duplicate into it."
    >
      <div className="space-y-3" aria-busy="true" aria-label="Loading merge preview">
        <div className="rounded-sm border border-border p-4">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="mt-3 h-3 w-4/5" />
          <Skeleton className="mt-2 h-3 w-3/5" />
        </div>
        <div className="rounded-sm border border-border p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-3 h-3 w-3/4" />
        </div>
      </div>
    </ObjectMergeRouteModalFrame>
  );
}
