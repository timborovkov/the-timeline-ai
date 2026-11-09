import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { EditorialBreadcrumb } from '@/components/marketing/editorial/editorial-breadcrumb';
import { EditorialKicker } from '@/components/marketing/editorial/editorial-kicker';
import { EditorialSectionHeading } from '@/components/marketing/editorial/editorial-section-heading';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import styles from '@/components/marketing/editorial/editorial.module.css';
import { MarketingProductScreenshot } from '@/components/marketing/product-screenshot';
import { MarketingCtaBand } from '@/components/marketing/start-free-cta';
import {
  findUseCaseByRoute,
  USE_CASE_HUB,
  type UseCaseContent,
} from '@/components/marketing/use-cases/content';
import { findUseCasePublicDocument } from '@/components/marketing/use-cases/public-documents';
import { buildPublicStructuredData } from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';

export function UseCasePage({ useCase }: { useCase: UseCaseContent }) {
  const related = useCase.relatedRoutes.map(findUseCaseByRoute);
  const afterSubhead = useCase.screenshots.filter((shot) => shot.placement === 'after-subhead');
  const afterHowItWorks = useCase.screenshots.filter(
    (shot) => shot.placement === 'after-how-it-works',
  );

  return (
    <main id="main" tabIndex={-1} data-use-case-route={useCase.route}>
      <EditorialStructuredData
        data={buildPublicStructuredData(findUseCasePublicDocument(useCase), getSiteUrl())}
      />
      <article>
        <header className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <EditorialBreadcrumb
            items={[
              { href: '/', label: 'The Timeline' },
              { href: USE_CASE_HUB.route, label: 'Use cases' },
              { label: useCase.navLabel },
            ]}
          />

          <EditorialKicker>{useCase.eyebrow}</EditorialKicker>
          <h1 className={`${styles.guideTitle} mt-6`}>{useCase.title}</h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-fg-muted sm:text-xl">
            {useCase.summary}
          </p>
          {useCase.problemLine ? (
            <p className="mt-6 max-w-2xl text-base leading-7 text-fg-muted">
              {useCase.problemLine}
            </p>
          ) : null}

          <div className="mt-10 grid gap-6">
            {afterSubhead.map((shot) => (
              <MarketingProductScreenshot
                key={shot.file}
                file={shot.file}
                alt={shot.alt}
                caption={shot.caption}
                reshoot={shot.reshoot}
                callouts={shot.callouts}
                priority
              />
            ))}
          </div>
        </header>

        {useCase.howItWorks ? (
          <section
            className="border-y border-border bg-surface/45"
            aria-labelledby="how-it-works-title"
          >
            <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[0.42fr_1fr]">
              <div>
                <EditorialKicker>How it works</EditorialKicker>
                <h2
                  id="how-it-works-title"
                  className="mt-5 text-2xl font-semibold tracking-[-0.035em]"
                >
                  From conversation to current record.
                </h2>
              </div>
              <p className={`${styles.readingMeasure} text-base leading-8 text-fg-muted`}>
                {useCase.howItWorks}
              </p>
            </div>
          </section>
        ) : null}

        {useCase.blocks ? (
          <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
            <div className="grid gap-px bg-border sm:grid-cols-2">
              {useCase.blocks.map((block) => (
                <article key={block.title} className="bg-bg p-6 sm:p-8">
                  <h2 className="text-xl font-semibold tracking-[-0.025em]">{block.title}</h2>
                  <p className="mt-4 text-sm leading-7 text-fg-muted">{block.body}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {afterHowItWorks.length > 0 ? (
          <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24">
            <div className="grid gap-6">
              {afterHowItWorks.map((shot) => (
                <MarketingProductScreenshot
                  key={shot.file}
                  file={shot.file}
                  alt={shot.alt}
                  caption={shot.caption}
                  reshoot={shot.reshoot}
                  callouts={shot.callouts}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="border-y border-border bg-surface/45">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[0.78fr_1.22fr]">
            <div>
              <EditorialSectionHeading index="Example" title="A fictional walk-through." />
              {useCase.needs ? (
                <div className="mt-10">
                  <h3 className="text-lg font-semibold tracking-[-0.02em]">What it needs</h3>
                  <p className="mt-3 text-sm leading-7 text-fg-muted sm:text-base">
                    {useCase.needs}
                  </p>
                </div>
              ) : null}
              {useCase.whoItsFor ? (
                <div className="mt-10">
                  <h3 className="text-lg font-semibold tracking-[-0.02em]">Who it’s for</h3>
                  <p className="mt-3 text-sm leading-7 text-fg-muted sm:text-base">
                    {useCase.whoItsFor}
                  </p>
                </div>
              ) : null}
              {useCase.boundary ? (
                <div className="mt-10">
                  <h3 className="text-lg font-semibold tracking-[-0.02em]">Boundary</h3>
                  <p className="mt-3 text-sm leading-7 text-fg-muted sm:text-base">
                    {useCase.boundary}
                  </p>
                </div>
              ) : null}
            </div>
            <aside
              className={`${styles.promptBlock} p-7 sm:p-9`}
              aria-label={useCase.example.label}
            >
              <div className="relative z-10">
                <p className="font-mono text-[0.68rem] tracking-[0.14em] text-signal uppercase">
                  {useCase.example.label}
                </p>
                {useCase.example.title ? (
                  <h2 className="mt-5 max-w-2xl text-balance text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
                    {useCase.example.title}
                  </h2>
                ) : null}
                <ol className="mt-8 grid gap-3">
                  {useCase.example.lines.map((line, index) => (
                    <li key={line} className="grid grid-cols-[1.6rem_1fr] gap-3 text-sm leading-6">
                      <span className="grid size-6 place-items-center rounded-full border border-signal font-mono text-[0.62rem] text-signal">
                        {index + 1}
                      </span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-8 border-t border-border pt-5 font-mono text-[0.65rem] leading-5 text-fg-muted">
                  Fictional Acme Labs example, not customer data.
                </p>
              </div>
            </aside>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <EditorialSectionHeading index="Questions" title="Common questions." />
          <div className="mt-10 divide-y divide-border border-y border-border">
            {useCase.faqs.map((faq) => (
              <details key={faq.question} className="group py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-sm py-5 text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
                  {faq.question}
                  <span aria-hidden="true" className="font-mono text-signal group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="max-w-3xl pb-6 text-sm leading-7 text-fg-muted sm:text-base">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <EditorialSectionHeading index="Explore" title="Related use cases." />
            <div className="mt-10 grid gap-px bg-border sm:grid-cols-2">
              {related.map((item) => (
                <Link
                  key={item.route}
                  href={item.route}
                  className="group bg-bg p-6 outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-8"
                >
                  <p className="font-mono text-[0.65rem] tracking-[0.12em] text-signal uppercase">
                    {item.eyebrow}
                  </p>
                  <h3 className="mt-5 text-xl font-semibold tracking-[-0.025em]">
                    {item.cardTitle}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-fg-muted">{item.cardBody}</p>
                  <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium">
                    Read the use case
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-1"
                    />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <MarketingCtaBand
          title="Link one channel. Watch the record fill in."
          body="Start with one Slack channel or Telegram group. Read the daily update, approve lasting record changes that The Timeline proposes, and ask what was decided, with the source for every line."
          firstRun={useCase.slug === 'team-daily-log'}
        />
      </article>
    </main>
  );
}
