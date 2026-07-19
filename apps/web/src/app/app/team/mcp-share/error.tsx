'use client';

import { RouteError } from '@/components/route-error';

export default function McpShareError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="MCP sharing" error={error} reset={reset} />;
}
