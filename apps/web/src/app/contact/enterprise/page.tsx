import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EnterpriseEnquiryForm } from '@/components/marketing/enterprise-enquiry-form';
import { MarketingContainer } from '@/components/marketing/marketing-layout';
import { SupportMailto } from '@/components/support-email-provider';
import {
  ENTERPRISE_RESPONSE_EXPECTATION,
  parseEnterpriseEnquiryPrefill,
} from '@/lib/enterprise-enquiry';
import { publicMetadata } from '@/lib/public-metadata';

export const metadata: Metadata = publicMetadata({
  title: 'Enterprise enquiry',
  description:
    'Talk with Timeline about procurement, security review, SSO, SLA, data residency, or a custom Enterprise plan.',
  path: '/contact/enterprise',
});

export const dynamic = 'force-dynamic';

export default async function EnterpriseContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const prefill = parseEnterpriseEnquiryPrefill(await searchParams);

  return (
    <main id="main" tabIndex={-1}>
      <MarketingContainer>
        <article className="mx-auto max-w-2xl space-y-10 py-12 sm:py-16">
          <header className="space-y-4">
            <Link
              href="/pricing"
              className="inline-flex min-h-10 items-center gap-2 rounded-sm text-sm font-medium text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back to pricing
            </Link>
            <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
              Enterprise enquiry
            </h1>
            <p className="text-lg text-fg-muted">
              For procurement, security review, SSO, SLA, data residency, or committed volume. Not
              for routine product support — use{' '}
              <Link
                href="/help/support"
                className="text-fg underline decoration-border underline-offset-4 hover:decoration-fg"
              >
                Help and support
              </Link>{' '}
              for that.
            </p>
            <p className="text-sm text-fg-muted">{ENTERPRISE_RESPONSE_EXPECTATION}</p>
          </header>

          <EnterpriseEnquiryForm prefill={prefill} />

          <p className="text-sm text-fg-muted">
            Prefer email? Write to{' '}
            <SupportMailto className="text-fg underline underline-offset-4" /> with “Enterprise” in
            the subject.
          </p>
        </article>
      </MarketingContainer>
    </main>
  );
}
