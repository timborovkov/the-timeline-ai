'use client';

import { RouteError } from '@/components/route-error';

export default function EntitiesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Entities" error={error} reset={reset} />;
}
