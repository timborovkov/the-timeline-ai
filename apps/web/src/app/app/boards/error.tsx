'use client';
import { RouteError } from '@/components/route-error';
export default function BoardsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Boards" error={error} reset={reset} />;
}
