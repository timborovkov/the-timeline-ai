'use client';

import { RouteError } from '@/components/route-error';

export default function InboxError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Captured inbox" error={error} reset={reset} />;
}
