import Link from 'next/link';

import type { Metadata } from 'next';

import { SEE_IT_FIRST_HREF, SEE_IT_FIRST_LABEL } from '@/components/marketing/copy';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import { MarketingContainer, MarketingSectionGrid } from '@/components/marketing/marketing-layout';
import {
  PricingComparisonTable,
  PricingEnterpriseNudge,
  PricingMetersExplainer,
  PricingPlanGrid,
} from '@/components/marketing/pricing-blocks';
import { PricingFaq } from '@/components/marketing/pricing-faq';
import { MarketingSectionIndex } from '@/components/marketing/section-index';
import {
  PUBLIC_DOCUMENT_REGISTRY,
  buildPublicStructuredData,
  metadataForPublicDocument,
} from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';

const PRICING_DOCUMENT = getPricingDocument();

export const metadata: Metadata = metadataForPublicDocument(PRICING_DOCUMENT);

function getPricingDocument() {
  const document = PUBLIC_DOCUMENT_REGISTRY.get('/pricing');
  if (!document) throw new Error('The public document registry is missing the pricing page');
  return document;
}

export default function PricingPage() {
  return (
    <main id="main" tabIndex={-1}>
      <EditorialStructuredData data={buildPublicStructuredData(PRICING_DOCUMENT, getSiteUrl())} />
      <section className="border-b border-border">
        <MarketingContainer className="py-16 sm:py-24 lg:py-28">
          <p className="text-sm font-medium text-fg-muted">Pricing</p>
          <div className="mt-6 grid items-end gap-10 lg:grid-cols-[1.25fr_0.75fr]">
            <h1 className="max-w-[14ch] break-words text-balance text-[3rem] font-semibold leading-[0.95] tracking-[-0.05em] text-fg sm:text-[clamp(3.5rem,5vw,5.5rem)]">
              Start free. Pay for what you use.
            </h1>
            <div className="max-w-[44ch] space-y-4 text-base leading-relaxed text-fg-muted sm:text-lg">
              <p>
                Start with Free, with no card required. Pay as you go keeps the Free allowance and
                charges for usage beyond it. Choose Team or Business for more included usage and
                members.
              </p>
              <p>
                Not sure yet?{' '}
                <Link
                  href={SEE_IT_FIRST_HREF}
                  className="rounded-sm font-medium text-fg underline decoration-border-strong underline-offset-4 outline-none hover:decoration-fg focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {SEE_IT_FIRST_LABEL}
                </Link>
              </p>
            </div>
          </div>
        </MarketingContainer>
      </section>

      <section className="border-b border-border">
        <MarketingContainer className="py-16 sm:py-20">
          <MarketingSectionGrid>
            <MarketingSectionIndex index="01" label="Plans" />
            <div>
              <h2 className="max-w-[18ch] text-3xl font-semibold tracking-tight sm:text-4xl">
                Choose the plan that fits.
              </h2>
              <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                All prices are in euros and exclude VAT.
              </p>
              <PricingPlanGrid className="mt-10" />
              <PricingEnterpriseNudge className="mt-4" />
            </div>
          </MarketingSectionGrid>
        </MarketingContainer>
      </section>

      <section className="border-b border-border bg-surface/45">
        <MarketingContainer className="py-16 sm:py-20">
          <MarketingSectionGrid>
            <MarketingSectionIndex index="02" label="Usage" />
            <div>
              <h2 className="max-w-[20ch] text-3xl font-semibold tracking-tight sm:text-4xl">
                Usage-based pricing.
              </h2>
              <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                See what AI, meetings, email, and storage cost. Your Usage page shows how much
                you’ve used and the corresponding cost in euros.
              </p>
              <PricingMetersExplainer className="mt-10" />
            </div>
          </MarketingSectionGrid>
        </MarketingContainer>
      </section>

      <section className="border-b border-border">
        <MarketingContainer className="py-16 sm:py-20">
          <MarketingSectionGrid>
            <MarketingSectionIndex index="03" label="Compare" />
            <div>
              <h2 className="max-w-[16ch] text-3xl font-semibold tracking-tight sm:text-4xl">
                Compare plans.
              </h2>
              <PricingComparisonTable className="mt-10" />
            </div>
          </MarketingSectionGrid>
        </MarketingContainer>
      </section>

      <section>
        <MarketingContainer className="py-16 sm:py-20">
          <MarketingSectionGrid>
            <MarketingSectionIndex index="04" label="Billing" />
            <div>
              <h2 className="max-w-[18ch] text-3xl font-semibold tracking-tight sm:text-4xl">
                How billing works.
              </h2>
              <ul className="mt-6 max-w-3xl list-disc space-y-3 pl-5 text-base leading-7 text-fg-muted">
                <li>
                  Each plan includes an allowance. Check the comparison above for included usage,
                  members, and any additional charges.
                </li>
                <li>
                  Your spend cap limits usage charges. Separate capacity limits apply to features
                  such as meeting notetakers, documents, and storage; see Infrastructure limits for
                  the details.
                </li>
                <li>
                  Reading, deletion, billing management, and export stay available when a spend cap
                  or balance is exhausted.
                </li>
              </ul>
            </div>
          </MarketingSectionGrid>
        </MarketingContainer>
      </section>

      <section className="border-t border-border bg-surface/45">
        <MarketingContainer className="py-16 sm:py-20">
          <MarketingSectionGrid>
            <MarketingSectionIndex index="05" label="FAQ" />
            <div>
              <h2 className="max-w-[16ch] text-3xl font-semibold tracking-tight sm:text-4xl">
                Common questions.
              </h2>
              <PricingFaq />
            </div>
          </MarketingSectionGrid>
        </MarketingContainer>
      </section>
    </main>
  );
}
