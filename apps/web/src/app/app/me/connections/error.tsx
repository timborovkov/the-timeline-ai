'use client';

import { RouteError } from '@/components/route-error';

export default function PersonalConnectionsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Personal connections" error={error} reset={reset} />;
}
