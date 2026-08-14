import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import type { Metadata } from 'next';

import {
  EDITORIAL_GUIDES,
  findEditorialGuideByRoute,
  GUIDE_ROUTES,
} from '@/components/marketing/editorial/content';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import {
  buildHowItWorksStructuredData,
  createHowItWorksMetadata,
} from '@/components/marketing/editorial/metadata';
import { ProvenanceDiagram } from '@/components/marketing/editorial/provenance-diagram';
import { MarketingContainer, MarketingSectionGrid } from '@/components/marketing/marketing-layout';
import { MarketingSectionIndex } from '@/components/marketing/section-index';

export const metadata: Metadata = createHowItWorksMetadata();

const HOW_IT_WORKS_STEPS = [
  {
    title: 'Capture',
    body: 'Choose the conversations, documents, and workspaces that belong in Timeline.',
  },
  {
    title: 'Order',
    body: 'Keep every record attached to its source, author, and time as one chronology forms.',
  },
  {
    title: 'Answer',
    body: 'Ask across that history and inspect the citations, uncertainty, and missing evidence.',
  },
] as const;

export default function HowItWorksPage() {
  const featuredGuide = findEditorialGuideByRoute(GUIDE_ROUTES.slackAndDrive);

  return (
    <main id="main" tabIndex={-1}>
      <EditorialStructuredData data={buildHowItWorksStructuredData()} />
      <section data-how-it-works-hero className="border-b border-border">
        <MarketingContainer className="py-16 sm:py-24 lg:py-28">
          <p className="text-sm font-medium text-fg-muted">How Timeline works</p>
          <div className="mt-6 grid items-end gap-10 lg:grid-cols-[1.25fr_0.75fr]">
            <h1 className="max-w-[13ch] break-words text-balance text-[3rem] font-semibold leading-[0.95] tracking-[-0.05em] text-fg sm:text-[clamp(3.5rem,5vw,5.5rem)]">
              From scattered work to a cited answer.
            </h1>
            <p className="max-w-[44ch] text-base leading-relaxed text-fg-muted sm:text-lg">
              Timeline captures selected records from the tools your team already uses, orders them
              by time, and answers with links back to the evidence.
            </p>
          </div>

          <ol
            data-how-it-works-steps
            className="mt-12 grid border-y border-border md:grid-cols-3 md:divide-x md:divide-border"
          >
            {HOW_IT_WORKS_STEPS.map((step, index) => (
              <li key={step.title} className="py-6 md:px-7 md:py-8 md:first:pl-0 md:last:pr-0">
                <div className="flex items-baseline gap-4">
                  <span className="font-mono text-[0.68rem] tracking-[0.12em] text-signal">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h2 className="text-xl font-semibold tracking-[-0.025em]">{step.title}</h2>
                </div>
                <p className="mt-3 max-w-sm pl-9 text-sm leading-6 text-fg-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </MarketingContainer>
      </section>

      <section data-how-it-works-evidence className="border-b border-border bg-surface/45">
        <MarketingContainer className="py-16 sm:py-20">
          <MarketingSectionGrid>
            <MarketingSectionIndex index="02" label="Evidence path" />
            <div>
              <h2 className="max-w-[18ch] text-3xl font-semibold tracking-tight sm:text-4xl">
                Watch three records become one answer.
              </h2>
              <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                This illustrative example keeps every source distinct, places the records in time,
                and cites the evidence behind the conclusion.
              </p>
              <div className="mt-10">
                <ProvenanceDiagram diagram={featuredGuide.diagram} answerHeadingLevel={2} />
              </div>
            </div>
          </MarketingSectionGrid>
        </MarketingContainer>
      </section>

      <section>
        <MarketingContainer className="py-16 sm:py-20">
          <MarketingSectionGrid>
            <MarketingSectionIndex index="03" label="Practical walkthroughs" />
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
              Try one real question before connecting everything.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-fg-muted sm:text-lg">
              Use one project, the smallest useful source set, and a question whose answer you can
              check against the original work.
            </p>
          </div>
          <Link
            href={featuredGuide.route}
            className="inline-flex min-h-12 items-center gap-6 rounded-sm bg-signal px-5 font-semibold text-signal-fg outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Open the first walkthrough
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </MarketingContainer>
      </section>
    </main>
  );
}
