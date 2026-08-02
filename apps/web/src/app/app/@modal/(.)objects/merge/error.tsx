'use client';

import { ErrorState } from '@/components/error-state';
import { ObjectMergeRouteModalFrame } from '@/components/objects/object-merge-route-modal';

export default function MergeObjectModalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ObjectMergeRouteModalFrame
      title="Review merge"
      description="Choose the object to keep, then merge the duplicate into it."
    >
      <ErrorState
        title="Unable to load merge preview"
        description="The merge preview could not be loaded. No objects have been merged. Your saved object data is unchanged. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </ObjectMergeRouteModalFrame>
  );
}
