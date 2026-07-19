'use client';
import { RouteError } from '@/components/route-error';
export default function DocumentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Documents" error={error} reset={reset} />;
}
