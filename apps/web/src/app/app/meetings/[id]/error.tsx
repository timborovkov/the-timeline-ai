'use client';
import { RouteError } from '@/components/route-error';
export default function MeetingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Meeting" error={error} reset={reset} />;
}
