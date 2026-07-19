'use client';

import { RouteError } from '@/components/route-error';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Slack" error={error} reset={reset} />;
}
