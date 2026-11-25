import type { Metadata } from 'next';
import Link from 'next/link';

import { SEE_IT_FIRST_HREF, SEE_IT_FIRST_LABEL } from '@/components/marketing/copy';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import { MarketingContainer } from '@/components/marketing/marketing-layout';
import { PricingFaq } from '@/components/marketing/pricing-faq';
import styles from '@/components/marketing/pricing-page.module.css';
import { PricingPlanGrid } from '@/components/marketing/pricing-plan-grid';
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
              Bring your team’s work together in one record. Start with up to three members and
              upgrade to Team whenever you need it.
            </p>
            <nav className={styles.actions} aria-label="Pricing options">
              <Link href={SEE_IT_FIRST_HREF} className={styles.textLink}>
                {SEE_IT_FIRST_LABEL}
              </Link>
            </nav>
          </div>
        </header>
        <section className={styles.plans} aria-labelledby="pricing-plans-title">
          <div className={styles.planHeading}>
            <h2 id="pricing-plans-title">Choose how you pay.</h2>
            <p>Prices are in USD and exclude applicable taxes calculated at checkout.</p>
          </div>
          <PricingPlanGrid />
        </section>
        <section className={`${styles.section} ${styles.billing}`} aria-labelledby="billing-title">
          <h2 id="billing-title">One shared Included usage allowance.</h2>
          <ul>
            <li>
              AI answers, source analysis, background record maintenance, and native meeting capture
              draw from the same monthly allowance.
            </li>
            <li>
              Ordinary ingestion and storage are bundled and subject to fair-use limits. AI analysis
              of those records still uses the allowance.
            </li>
            <li>
              When Included usage runs out, new billable processing pauses and existing records stay
              accessible. Team admins can enable extra usage with a monthly spending cap.
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
        body="Invite up to three members to your Free workspace."
      />
    </main>
  );
}
