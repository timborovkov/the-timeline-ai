'use client';

import { RouteError } from '@/components/route-error';

export default function ChatError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Ask" error={error} reset={reset} />;
}
