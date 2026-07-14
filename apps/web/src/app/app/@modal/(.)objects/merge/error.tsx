'use client';

import { RouteError } from '@/components/route-error';

export default function MergeObjectModalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Merge objects" error={error} reset={reset} />;
}
