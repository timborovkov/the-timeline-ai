'use client';

import { LegalRouteError } from '@/components/legal-route-state';
import { PRIVACY_EFFECTIVE_DATE, PRIVACY_VERSION } from '@/lib/legal-versions';

export default function PrivacyError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <LegalRouteError
      eyebrow={`Version ${PRIVACY_VERSION} · Effective ${PRIVACY_EFFECTIVE_DATE}`}
      title="Privacy Policy"
      description={
        'This policy explains how The Timeline processes personal data for team memory, capture, search, and AI-assisted workflows.'
      }
      error={error}
      reset={reset}
    />
  );
}
