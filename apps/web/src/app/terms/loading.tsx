import { LegalRouteLoading } from '@/components/legal-route-state';
import { TERMS_EFFECTIVE_DATE, TERMS_VERSION } from '@/lib/legal-versions';

export default function TermsLoading() {
  return (
    <LegalRouteLoading
      eyebrow={`Version ${TERMS_VERSION} · Effective ${TERMS_EFFECTIVE_DATE}`}
      title="Terms of Use"
      description="These terms govern access to The Timeline, a team memory product operated by Nyxone OÜ."
    />
  );
}
