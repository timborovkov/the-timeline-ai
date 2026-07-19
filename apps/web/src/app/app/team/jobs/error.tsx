'use client';
import { RouteError } from '@/components/route-error';
export default function JobsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Background jobs" error={error} reset={reset} />;
}
