import { LegalRouteLoading } from '@/components/legal-route-state';
import { PRIVACY_EFFECTIVE_DATE, PRIVACY_VERSION } from '@/lib/legal-versions';

export default function PrivacyLoading() {
  return (
    <LegalRouteLoading
      eyebrow={`Version ${PRIVACY_VERSION} · Effective ${PRIVACY_EFFECTIVE_DATE}`}
      title="Privacy Policy"
      description="How The Timeline collects, uses, shares, protects, and retains personal data—including content processed by AI and connected services."
    />
  );
}
