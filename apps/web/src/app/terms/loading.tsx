import { LegalRouteLoading } from '@/components/legal-route-state';
import { LEGAL_EFFECTIVE_DATE, TERMS_VERSION } from '@/lib/legal-versions';

export default function TermsLoading() {
  return (
    <LegalRouteLoading
      eyebrow={`Version ${TERMS_VERSION} · Effective ${LEGAL_EFFECTIVE_DATE}`}
      title="Terms of Use"
      description="The agreement governing access to The Timeline, including team authority, captured content, AI features, acceptable use, and responsibility."
    />
  );
}
