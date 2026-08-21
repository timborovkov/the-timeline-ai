import type { Metadata } from 'next';

import { MarketingContainer, MarketingSectionGrid } from '@/components/marketing/marketing-layout';
import {
  PricingComparisonTable,
  PricingEnterpriseNudge,
  PricingMetersExplainer,
  PricingPlanGrid,
} from '@/components/marketing/pricing-blocks';
import { MarketingSectionIndex } from '@/components/marketing/section-index';
import { auth } from '@/lib/auth';
import { publicMetadata } from '@/lib/public-metadata';

export const metadata: Metadata = publicMetadata({
  title: 'Pricing',
  description:
    'Free for small teams, pay as you go with native AI, meeting, email, and storage meters, plus optional Team and Business commitments. EUR, excl. VAT.',
  path: '/pricing',
});

export default async function PricingPage() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  return (
    <main id="main" tabIndex={-1}>
      <section className="border-b border-border">
        <MarketingContainer className="py-16 sm:py-24 lg:py-28">
          <p className="text-sm font-medium text-fg-muted">Pricing</p>
          <div className="mt-6 grid items-end gap-10 lg:grid-cols-[1.25fr_0.75fr]">
            <h1 className="max-w-[14ch] break-words text-balance text-[3rem] font-semibold leading-[0.95] tracking-[-0.05em] text-fg sm:text-[clamp(3.5rem,5vw,5.5rem)]">
              Start free. Pay for measured work.
            </h1>
            <p className="max-w-[44ch] text-base leading-relaxed text-fg-muted sm:text-lg">
              No mandatory upgrade cliff. Free stays useful without a card. Pay as you go keeps the
              Free allowance and charges native overage. Team and Business are optional commitments
              — never member-count gates.
            </p>
          </div>
        </MarketingContainer>
      </section>

      <section className="border-b border-border">
        <MarketingContainer className="py-16 sm:py-20">
          <MarketingSectionGrid>
            <MarketingSectionIndex index="01" label="Plans" />
            <div>
              <h2 className="max-w-[18ch] text-3xl font-semibold tracking-tight sm:text-4xl">
                One Free journey. Optional commitments.
              </h2>
              <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                Prices in EUR, excluding VAT. Catalog and Polar meters are live in sandbox; customer
                charges stay in shadow mode until provider reconciliation completes.
              </p>
              <PricingPlanGrid className="mt-10" signedIn={signedIn} />
              <PricingEnterpriseNudge className="mt-4" />
            </div>
          </MarketingSectionGrid>
        </MarketingContainer>
      </section>

      <section className="border-b border-border bg-surface/45">
        <MarketingContainer className="py-16 sm:py-20">
          <MarketingSectionGrid>
            <MarketingSectionIndex index="02" label="Meters" />
            <div>
              <h2 className="max-w-[20ch] text-3xl font-semibold tracking-tight sm:text-4xl">
                Native units, euro values.
              </h2>
              <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                Meter in the unit that creates cost. Display the native unit and its euro value. If
                we ever say “credits,” they mean euros:{' '}
                <span className="font-mono text-fg">100 credits = €1</span>.
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
                Side-by-side limits.
              </h2>
              <PricingComparisonTable className="mt-10" />
            </div>
          </MarketingSectionGrid>
        </MarketingContainer>
      </section>

      <section>
        <MarketingContainer className="py-16 sm:py-20">
          <MarketingSectionGrid>
            <MarketingSectionIndex index="04" label="Notes" />
            <div>
              <h2 className="max-w-[18ch] text-3xl font-semibold tracking-tight sm:text-4xl">
                Launch assumptions.
              </h2>
              <ul className="mt-6 max-w-3xl list-disc space-y-3 pl-5 text-base leading-7 text-fg-muted">
                <li>
                  Included member counts (25 / 100) and the 500-member self-serve ceiling are
                  provisional, not permanent product walls.
                </li>
                <li>
                  Capacity ceilings (turns, webhooks, storage) are abuse and infrastructure
                  controls; the AI euro budget remains the financial ceiling.
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
    </main>
  );
}
