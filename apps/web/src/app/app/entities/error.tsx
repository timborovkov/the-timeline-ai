'use client';

import ObjectsError from '@/app/app/objects/error';

export default function EntitiesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Legacy entity links now resolve to Objects, so their recovery state must
  // retain the destination's route context rather than reintroduce Entities.
  return <ObjectsError error={error} reset={reset} />;
}
