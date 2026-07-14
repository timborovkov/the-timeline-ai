'use client';

import { RouteError } from '@/components/route-error';

export default function EntityError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Entity" error={error} reset={reset} />;
}
