'use client';

import { LegalRouteError } from '@/components/legal-route-state';

export default function TrustError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <LegalRouteError
      eyebrow="Trust · Last reviewed 21 August 2026"
      title="Trust, security, and data privacy"
      description="How The Timeline protects team data across AI inference, storage, permissions, meetings, analytics, and human access."
      footerLabel="The Timeline trust center"
      error={error}
      reset={reset}
    />
  );
}
