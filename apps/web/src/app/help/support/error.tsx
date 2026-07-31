'use client';

import { HelpRouteError } from '@/components/help/help-route-error';

export default function SupportError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <HelpRouteError
      title="Support"
      description="The support request form could not be loaded."
      variant="support"
      error={error}
      reset={reset}
    />
  );
}
