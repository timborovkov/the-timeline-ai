'use client';
import { RouteError } from '@/components/route-error';
export default function ApprovalsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Approvals" error={error} reset={reset} />;
}
