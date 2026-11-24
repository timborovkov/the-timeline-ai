import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EnterpriseEnquiryForm } from '@/components/marketing/enterprise-enquiry-form';
import { MarketingContainer } from '@/components/marketing/marketing-layout';
import { SupportMailto } from '@/components/support-email-provider';
import {
  ENTERPRISE_RESPONSE_EXPECTATION,
  parseEnterpriseEnquiryPrefill,
  parseEnterpriseTopicPrefill,
} from '@/lib/enterprise-enquiry';
import { publicMetadata } from '@/lib/public-metadata';
import {
  GITHUB_LICENSE_URL,
  GITHUB_REPOSITORY_URL,
  GITHUB_SELF_HOSTING_URL,
} from '@/lib/support-links';

export const metadata: Metadata = publicMetadata({
  title: 'Enterprise enquiry',
  description: 'Discuss custom pricing, volume, deployment and support needs with The Timeline.',
  path: '/contact/enterprise',
});

export const dynamic = 'force-dynamic';

export default async function EnterpriseContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const prefill = parseEnterpriseEnquiryPrefill(params);
  const defaultTopics = parseEnterpriseTopicPrefill(params);

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
              Discuss custom pricing, volume, support and deployment needs. For routine product
              support, use{' '}
              <Link
                href="/help/support"
                className="text-fg underline decoration-border underline-offset-4 hover:decoration-fg"
              >
                Help and support
              </Link>
              .
            </p>
            <p className="text-sm text-fg-muted">{ENTERPRISE_RESPONSE_EXPECTATION}</p>
          </header>

          <section
            aria-labelledby="enterprise-deployment-title"
            className="space-y-3 border border-border bg-surface-2 p-5 text-sm leading-6 text-fg-muted"
            data-enterprise-deployment
          >
            <h2 id="enterprise-deployment-title" className="text-base font-semibold text-fg">
              Deployment options
            </h2>
            <p>
              The Timeline team can set up and maintain an on-premise or private-cloud deployment
              for your organisation. Choose “On-premise deployment” below and tell us the
              environment you need.
            </p>
            <p>
              Anyone can also deploy The Timeline themselves from the{' '}
              <a
                href={GITHUB_REPOSITORY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-fg underline decoration-border underline-offset-4 hover:decoration-fg"
              >
                public GitHub repository
              </a>
              . It is source-available under the{' '}
              <a
                href={GITHUB_LICENSE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-fg underline decoration-border underline-offset-4 hover:decoration-fg"
              >
                Elastic License 2.0
              </a>
              : you may use, modify, and self-host it for your own organisation, but not offer it to
              third parties as a hosted or managed service, and not remove licensing notices.
              Self-hosted operators configure their own connectors and AI providers (LLM calls go
              through an OpenAI-compatible endpoint). See the{' '}
              <a
                href={GITHUB_SELF_HOSTING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-fg underline decoration-border underline-offset-4 hover:decoration-fg"
              >
                self-hosting guide
              </a>
              .
            </p>
          </section>

          <EnterpriseEnquiryForm prefill={prefill} defaultTopics={defaultTopics} />

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
