'use client';

import { LegalRouteError } from '@/components/legal-route-state';

export default function CookiesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <LegalRouteError
      eyebrow="Notice · Last reviewed 21 August 2026"
      title="Cookies and similar technologies"
      description="The cookies, browser storage, analytics, and related technologies used by The Timeline."
      error={error}
      reset={reset}
    />
  );
}
