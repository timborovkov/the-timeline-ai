'use client';

import { LegalRouteError } from '@/components/legal-route-state';
import { TERMS_EFFECTIVE_DATE, TERMS_VERSION } from '@/lib/legal-versions';

export default function TermsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <LegalRouteError
      eyebrow={`Version ${TERMS_VERSION} · Effective ${TERMS_EFFECTIVE_DATE}`}
      title="Terms of Use"
      description="These terms govern access to The Timeline, a team memory product operated by Nyxone OÜ."
      error={error}
      reset={reset}
    />
  );
}
