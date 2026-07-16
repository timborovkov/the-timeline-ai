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
        title="Couldn’t load merge preview"
        description="The selected objects could not be loaded. Try the request again."
        error={error}
        reset={reset}
      />
    </ObjectMergeRouteModalFrame>
  );
}
