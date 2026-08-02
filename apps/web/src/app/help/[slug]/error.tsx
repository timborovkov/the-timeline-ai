'use client';

import { HelpRouteError } from '@/components/help/help-route-error';

export default function HelpTopicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <HelpRouteError
      title="Guide"
      description="This Timeline guide could not be loaded."
      variant="guide"
      error={error}
      reset={reset}
    />
  );
}
