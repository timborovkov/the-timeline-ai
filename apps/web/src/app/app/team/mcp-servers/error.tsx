'use client';

import { RouteError } from '@/components/route-error';

export default function McpServersError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="MCP servers" error={error} reset={reset} />;
}
