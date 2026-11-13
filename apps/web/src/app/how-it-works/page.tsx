import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import type { Metadata } from 'next';

import {
  EVIDENCE_FRESHNESS_FAQS,
  EDITORIAL_GUIDES,
  findEditorialGuideByRoute,
  GUIDE_ROUTES,
  HOW_IT_WORKS_EVIDENCE_SHOT,
  HOW_IT_WORKS_FLOW_SHOT,
} from '@/components/marketing/editorial/content';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import {
  buildHowItWorksStructuredData,
  createHowItWorksMetadata,
} from '@/components/marketing/editorial/metadata';
import { ProvenanceDiagram } from '@/components/marketing/editorial/provenance-diagram';
import { TimelineFlowDiagram } from '@/components/marketing/home/timeline-flow-diagram';
import { MarketingContainer, MarketingSectionGrid } from '@/components/marketing/marketing-layout';
import { PreservesStrip } from '@/components/marketing/preserves-strip';
import { MarketingProductScreenshot } from '@/components/marketing/product-screenshot';

export const metadata: Metadata = createHowItWorksMetadata();

export default function HowItWorksPage() {
  const featuredGuide = findEditorialGuideByRoute(GUIDE_ROUTES.slackAndDrive);

  return (
    <main id="main" tabIndex={-1}>
      <EditorialStructuredData data={buildHowItWorksStructuredData()} />
      <section data-how-it-works-hero className="border-b border-border">
        <MarketingContainer className="py-16 sm:py-24 lg:py-28">
          <div className="grid items-end gap-10 lg:grid-cols-[1.25fr_0.75fr]">
            <h1 className="max-w-[13ch] break-words text-balance text-[3rem] font-semibold leading-[0.95] tracking-[-0.05em] text-fg sm:text-[clamp(3.5rem,5vw,5.5rem)]">
              From conversation to current record.
            </h1>
            <p className="max-w-[44ch] text-base leading-relaxed text-fg-muted sm:text-lg">
              Connect the chats, email and calls where work happens. The Timeline captures them in
              order, proposes updates to your records, and you approve what changes. You don’t have
              to replace the tools your team already uses.
            </p>
          </div>
        </MarketingContainer>
      </section>

      <div data-how-it-works-flow className="border-b border-border">
        <MarketingContainer className="py-12 sm:py-16">
          <TimelineFlowDiagram variant="expanded" id="how-it-works-platform-flow" />
          <div className="mt-12">
            <MarketingProductScreenshot
              file={HOW_IT_WORKS_FLOW_SHOT.file}
              alt={HOW_IT_WORKS_FLOW_SHOT.alt}
              caption={HOW_IT_WORKS_FLOW_SHOT.caption}
            />
          </div>
          <div className="mt-12">
            <PreservesStrip />
          </div>
        </MarketingContainer>
      </div>

      <section data-how-it-works-evidence className="border-b border-border bg-surface/45">
        <MarketingContainer className="py-16 sm:py-20">
          <MarketingSectionGrid>
            <div>
              <h2 className="max-w-[18ch] text-3xl font-semibold tracking-tight sm:text-4xl">
                Trace one answer to its evidence.
              </h2>
              <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                Three source records become one answer you can verify.
              </p>
              <div className="mt-10">
                <ProvenanceDiagram diagram={featuredGuide.diagram} answerHeadingLevel={2} />
              </div>
              <div className="mt-12">
                <MarketingProductScreenshot
                  file={HOW_IT_WORKS_EVIDENCE_SHOT.file}
                  alt={HOW_IT_WORKS_EVIDENCE_SHOT.alt}
                  caption={HOW_IT_WORKS_EVIDENCE_SHOT.caption}
                />
              </div>
            </div>
          </MarketingSectionGrid>
        </MarketingContainer>
      </section>

      <section>
        <MarketingContainer className="py-16 sm:py-20">
          <MarketingSectionGrid>
            <div>
              <h2 className="max-w-[20ch] text-3xl font-semibold tracking-tight sm:text-4xl">
                Start with a question your team already knows how to verify.
              </h2>
              <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                These examples show the method on three common cross-tool questions. The sources
                stay distinct, and every conclusion keeps its evidence attached.
              </p>
              <div className="mt-10 border-y border-border">
                {EDITORIAL_GUIDES.map((guide, index) => (
                  <Link
                    key={guide.route}
                    href={guide.route}
                    className="group grid gap-5 border-b border-border px-1 py-8 outline-none last:border-b-0 hover:bg-surface/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-5 md:grid-cols-[2.5rem_minmax(0,1fr)_auto] md:items-center"
                  >
                    <span className="font-mono text-[0.68rem] text-signal">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <p className="font-mono text-[0.62rem] tracking-[0.1em] text-fg-dim uppercase">
                        {guide.nativeConnectors.join(' + ')}
                      </p>
                      <h3 className="mt-3 max-w-3xl text-balance text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
                        {guide.title}
                      </h3>
                      <p className="mt-3 max-w-3xl text-sm leading-7 text-fg-muted sm:text-base">
                        {guide.summary}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-2 text-sm font-semibold md:justify-self-end">
                      Read walkthrough
                      <ArrowRight
                        aria-hidden="true"
                        className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-1"
                      />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </MarketingSectionGrid>
        </MarketingContainer>
      </section>

      <section className="border-y border-border bg-surface">
        <MarketingContainer className="grid gap-8 py-16 sm:py-20 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-sm font-medium text-fg-muted">Start with the answer</p>
            <h2 className="mt-5 max-w-3xl text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
              Start with one channel.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-fg-muted sm:text-lg">
              Use one project, the smallest useful source set, and a question whose answer you can
              check against the original work.
            </p>
          </div>
          <div className="flex flex-col items-start gap-4 lg:items-end">
            <Link
              href="/sign-up"
              className="inline-flex min-h-12 items-center gap-6 rounded-sm bg-signal px-5 font-semibold text-signal-fg outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Start free
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
            <p className="max-w-xs text-sm leading-6 text-fg-muted lg:text-right">
              Free for up to 3 members · no card required ·{' '}
              <Link
                href="/pricing"
                className="underline decoration-border-strong underline-offset-4 hover:decoration-fg"
              >
                See pricing
              </Link>
            </p>
            <Link
              href={featuredGuide.route}
              className="rounded-sm text-sm font-semibold text-fg underline decoration-border-strong underline-offset-4 outline-none hover:decoration-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Read the first walkthrough
            </Link>
          </div>
        </MarketingContainer>
      </section>
      <section className="border-t border-border" aria-labelledby="evidence-faq">
        <MarketingContainer className="py-16 sm:py-20">
          <h2 id="evidence-faq" className="text-3xl font-semibold tracking-tight">
            When evidence changes
          </h2>
          <div className="mt-8 max-w-3xl">
            {EVIDENCE_FRESHNESS_FAQS.map((faq) => (
              <details key={faq.question} className="border-b border-border py-5">
                <summary className="cursor-pointer font-medium">{faq.question}</summary>
                <p className="mt-3 leading-relaxed text-fg-muted">{faq.answer}</p>
              </details>
            ))}
            <Link href="/help/capture" className="mt-6 inline-flex underline underline-offset-4">
              How answers handle newer and conflicting evidence
            </Link>
          </div>
        </MarketingContainer>
      </section>
    </main>
  );
}
