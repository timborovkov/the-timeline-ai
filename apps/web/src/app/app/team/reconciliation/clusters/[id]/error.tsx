'use client';
import { RouteError } from '@/components/route-error';
export default function ClusterError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Reconciliation cluster" error={error} reset={reset} />;
}
