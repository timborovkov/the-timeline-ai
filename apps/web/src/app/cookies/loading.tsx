import { LegalRouteLoading } from '@/components/legal-route-state';
import { COOKIES_REVIEW_DATE } from '@/lib/legal-versions';

export default function CookiesLoading() {
  return (
    <LegalRouteLoading
      eyebrow={`Notice · Last reviewed ${COOKIES_REVIEW_DATE}`}
      title="Cookies and similar technologies"
      description="What The Timeline stores in your browser, what is necessary for the service, and how to control optional public analytics."
    />
  );
}
