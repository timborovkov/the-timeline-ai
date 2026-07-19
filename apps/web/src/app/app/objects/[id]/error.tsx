'use client';
import { RouteError } from '@/components/route-error';
export default function ObjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Object" error={error} reset={reset} />;
}
