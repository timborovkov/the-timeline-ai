'use client';
import { RouteError } from '@/components/route-error';
export default function CapturedDocumentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Captured documents" error={error} reset={reset} />;
}
