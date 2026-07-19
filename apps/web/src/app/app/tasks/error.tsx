'use client';
import { RouteError } from '@/components/route-error';
export default function TasksError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Tasks" error={error} reset={reset} />;
}
