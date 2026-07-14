'use client';
import { RouteError } from '@/components/route-error';
export default function ObjectsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Objects" error={error} reset={reset} />;
}
