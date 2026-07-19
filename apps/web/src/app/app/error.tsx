'use client';

import { RouteError } from '@/components/route-error';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="The Timeline" error={error} reset={reset} />;
}
