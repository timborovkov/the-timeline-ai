'use client';
import { RouteError } from '@/components/route-error';
export default function WorkError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Work" error={error} reset={reset} />;
}
