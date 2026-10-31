'use client';

import { LegalRouteError } from '@/components/legal-route-state';
import { TRUST_REVIEW_DATE } from '@/lib/legal-versions';

export default function TrustError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <LegalRouteError
      eyebrow={`Trust · Last reviewed ${TRUST_REVIEW_DATE}`}
      title="Trust, security, and data privacy"
      description="How The Timeline protects team data across AI inference, storage, permissions, meetings, analytics, and human access."
      footerLabel="The Timeline trust center"
      currentSection="trust"
      error={error}
      reset={reset}
    />
  );
}
