'use client';
import { RouteError } from '@/components/route-error';
export default function MeetingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Meetings" error={error} reset={reset} />;
}
