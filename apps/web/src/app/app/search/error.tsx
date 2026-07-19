'use client';
import { RouteError } from '@/components/route-error';
export default function SearchError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Search" error={error} reset={reset} />;
}
