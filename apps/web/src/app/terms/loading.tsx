import { LegalRouteLoading } from '@/components/legal-route-state';
import { LEGAL_EFFECTIVE_DATE, TERMS_VERSION } from '@/lib/legal-versions';

export default function TermsLoading() {
  return (
    <LegalRouteLoading
      eyebrow={`Version ${TERMS_VERSION} · Effective ${LEGAL_EFFECTIVE_DATE}`}
      title="Terms of Use"
      description="These terms govern access to The Timeline, a team memory product operated by Nyxone OÜ."
    />
  );
}
