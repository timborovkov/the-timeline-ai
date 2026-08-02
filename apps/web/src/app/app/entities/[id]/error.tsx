'use client';

import ObjectError from '@/app/app/objects/[id]/error';

export default function EntityError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Keep recovery aligned with the object detail destination of this legacy URL.
  return <ObjectError error={error} reset={reset} />;
}
