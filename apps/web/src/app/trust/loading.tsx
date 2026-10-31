import { LegalRouteLoading } from '@/components/legal-route-state';
import { TRUST_REVIEW_DATE } from '@/lib/legal-versions';
import { TRUST_DOCUMENT } from '@/lib/public-site/documents';

export default function TrustLoading() {
  return (
    <LegalRouteLoading
      eyebrow={`Trust · Last reviewed ${TRUST_REVIEW_DATE}`}
      title={TRUST_DOCUMENT.title}
      description={TRUST_DOCUMENT.description}
      footerLabel="The Timeline trust center"
      currentSection="trust"
    />
  );
}
