import Link from 'next/link';

import type { Metadata } from 'next';

import { SEE_IT_FIRST_HREF, SEE_IT_FIRST_LABEL } from '@/components/marketing/copy';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import { MarketingContainer } from '@/components/marketing/marketing-layout';
import {
  PricingComparisonTable,
  PricingEnterpriseNudge,
  PricingMetersExplainer,
  PricingPlanGrid,
} from '@/components/marketing/pricing-blocks';
import { PricingCalculator } from '@/components/marketing/pricing-calculator';
import { PricingFaq } from '@/components/marketing/pricing-faq';
import styles from '@/components/marketing/pricing-page.module.css';
import { MarketingCtaBand } from '@/components/marketing/start-free-cta';
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
    <main id="main" tabIndex={-1} className={styles.page}>
      <EditorialStructuredData data={buildPublicStructuredData(PRICING_DOCUMENT, getSiteUrl())} />
      <MarketingContainer>
        <header className={styles.hero}>
          <h1>Start free. No card required.</h1>
          <div>
            <p>
              Bring in your first source and try it with your team. Add payment for more usage, or
              choose a monthly plan with more members and usage included.
            </p>
            <nav className={styles.actions} aria-label="Pricing options">
              <a href="#estimate-usage" className={styles.textLink}>
                Estimate paid usage
              </a>
              <Link href={SEE_IT_FIRST_HREF} className={styles.textLink}>
                {SEE_IT_FIRST_LABEL}
              </Link>
            </nav>
          </div>
        </header>
        <section className={styles.plans} aria-labelledby="pricing-plans-title">
          <div className={styles.planHeading}>
            <h2 id="pricing-plans-title">Choose how you pay.</h2>
            <p>All prices are in euros and exclude VAT.</p>
          </div>
          <PricingPlanGrid />
          <PricingEnterpriseNudge className="mt-4" />
        </section>
        <section id="estimate-usage" className={styles.section} aria-labelledby="estimate-title">
          <div className={styles.sectionHeading}>
            <h2 id="estimate-title">Put your usage into the picture.</h2>
            <p>
              Compare Pay as you go, Team and Business using the same monthly usage. You do not need
              these numbers to start Free. This is an estimate, not a change to your billing.
            </p>
          </div>
          <PricingCalculator />
          <PricingMetersExplainer className="mt-8" />
        </section>
        <section className={styles.section} aria-labelledby="compare-plans-title">
          <div className={styles.sectionHeading}>
            <h2 id="compare-plans-title">The details, side by side.</h2>
            <p>
              Compare included members, usage and spending limits. Capacity limits are separate from
              what you pay.
            </p>
          </div>
          <PricingComparisonTable className="mt-8" />
        </section>
        <section className={`${styles.section} ${styles.billing}`} aria-labelledby="billing-title">
          <h2 id="billing-title">Stay in control of spend.</h2>
          <ul>
            <li>
              Your spend cap limits metered usage charges. Platform fees and tax are outside it. On
              Team and Business, the cap is checked before included usage credit.
            </li>
            <li>
              Separate <a href="#pricing-infrastructure">capacity limits</a> apply to meeting
              notetakers, documents, storage and other features. Reaching a limit can pause an
              action without charging extra.
            </li>
            <li>
              Reading, deletion, billing management, and export stay available when a spend cap or
              balance is exhausted.
            </li>
            <li>
              <Link href="/help/billing">How billing, limits and cancellation work</Link>
            </li>
          </ul>
        </section>
        <section
          className={`${styles.section} ${styles.billing}`}
          aria-labelledby="pricing-faq-title"
        >
          <h2 id="pricing-faq-title">Before you get started.</h2>
          <PricingFaq />
        </section>
      </MarketingContainer>
      <MarketingCtaBand
        title="Try it with your first source."
        body="Start with the Free allowance. Add payment when you need more."
      />
    </main>
  );
}
