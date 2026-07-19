'use client';
import { RouteError } from '@/components/route-error';
export default function SourcesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Connections" error={error} reset={reset} />;
}
