'use client';
import { RouteError } from '@/components/route-error';
export default function AuditError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Audit" error={error} reset={reset} />;
}
