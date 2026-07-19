'use client';

import { RouteError } from '@/components/route-error';

export default function PersonalMcpServersError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Personal MCP servers" error={error} reset={reset} />;
}
