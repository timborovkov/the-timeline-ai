'use client';

import { LegalRouteError } from '@/components/legal-route-state';
import { COOKIES_REVIEW_DATE } from '@/lib/legal-versions';

export default function CookiesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <LegalRouteError
      eyebrow={`Notice · Last reviewed ${COOKIES_REVIEW_DATE}`}
      title="Cookies and similar technologies"
      description="The cookies, browser storage, analytics, and related technologies used by The Timeline."
      error={error}
      reset={reset}
    />
  );
}
