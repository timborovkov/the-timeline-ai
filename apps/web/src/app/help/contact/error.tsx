'use client';

import { HelpRouteError } from '@/components/help/help-route-error';

export default function ContactError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <HelpRouteError
      title="Contact support"
      description="The support request form could not be opened."
      variant="support"
      error={error}
      reset={reset}
    />
  );
}
