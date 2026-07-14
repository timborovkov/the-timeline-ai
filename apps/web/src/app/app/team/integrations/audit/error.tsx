'use client';
import { RouteError } from '@/components/route-error';
export default function IntegrationAuditError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Integration audit" error={error} reset={reset} />;
}
