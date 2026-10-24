import { LegalRouteLoading } from '@/components/legal-route-state';
import { TRUST_DOCUMENT } from '@/lib/public-site/documents';

export default function TrustLoading() {
  return (
    <LegalRouteLoading
      eyebrow="Trust · Last reviewed 21 August 2026"
      title={TRUST_DOCUMENT.title}
      description={TRUST_DOCUMENT.description}
      footerLabel="The Timeline trust center"
    />
  );
}
