'use client';

import { RouteError } from '@/components/route-error';

export default function DocumentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Document" error={error} reset={reset} />;
}
