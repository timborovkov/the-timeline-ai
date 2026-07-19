'use client';

import { RouteError } from '@/components/route-error';

export default function BoardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Board" error={error} reset={reset} />;
}
