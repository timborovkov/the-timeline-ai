import { LegalRouteLoading } from '@/components/legal-route-state';
import { COOKIES_REVIEW_DATE } from '@/lib/legal-versions';

export default function CookiesLoading() {
  return (
    <LegalRouteLoading
      eyebrow={`Notice · Last reviewed ${COOKIES_REVIEW_DATE}`}
      title="Cookies and similar technologies"
      description="The cookies, browser storage, analytics, and related technologies used by The Timeline."
    />
  );
}
