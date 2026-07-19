'use client';
import { RouteError } from '@/components/route-error';
export default function CalendarError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Calendar" error={error} reset={reset} />;
}
