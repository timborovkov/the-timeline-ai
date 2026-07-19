'use client';

import { RouteError } from '@/components/route-error';

export default function TeamError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Team" error={error} reset={reset} />;
}
