import { ArrowRight, Plus } from 'lucide-react';
import Link from 'next/link';

import { EditorialBreadcrumb } from '@/components/marketing/editorial/editorial-breadcrumb';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import { MarketingContainer } from '@/components/marketing/marketing-layout';
import { MarketingProductScreenshot } from '@/components/marketing/product-screenshot';
import { MarketingCtaBand, StartFreeLink } from '@/components/marketing/start-free-cta';
import {
  findUseCaseByRoute,
  USE_CASE_HUB,
  type UseCaseContent,
} from '@/components/marketing/use-cases/content';
import { findUseCasePublicDocument } from '@/components/marketing/use-cases/public-documents';
import styles from '@/components/marketing/use-cases/use-case-page.module.css';
import { UseCasePreview } from '@/components/marketing/use-cases/use-case-preview';
import { buildPublicStructuredData } from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';

const processHeadings: Record<UseCaseContent['slug'], string> = {
  'work-record': 'The history and the current state.',
  'team-daily-log': 'Keep the team in the loop.',
  'communication-trail': 'Follow the agreement back to its source.',
  crm: 'Keep the relationship in context.',
  'task-board': 'From commitment to next step.',
  'onboarding-and-repeat-questions': 'Give the next person a head start.',
};

export function UseCasePage({ useCase }: { useCase: UseCaseContent }) {
  const related = useCase.relatedRoutes.map(findUseCaseByRoute);
  const afterSubhead = useCase.screenshots.filter((shot) => shot.placement === 'after-subhead');
  const afterHowItWorks = useCase.screenshots.filter(
    (shot) => shot.placement === 'after-how-it-works',
  );

  const exampleCard = (
    <aside className={styles.example} aria-label={useCase.example.label}>
      <div>
        {useCase.example.title ? (
          <h3 className="max-w-2xl text-balance text-xl font-medium tracking-[-0.025em]">
            {useCase.example.title}
          </h3>
        ) : null}
        <ol className={styles.exampleSteps}>
          {useCase.example.lines.map((line, index) => (
            <li
              key={line}
              className="grid grid-cols-[1.6rem_minmax(0,1fr)] gap-3 text-sm leading-6"
            >
              <span className="pt-0.5 font-mono text-xs text-signal">{index + 1}</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );

  return (
    <main id="main" tabIndex={-1} data-use-case-route={useCase.route} className={styles.page}>
      <EditorialStructuredData
        data={buildPublicStructuredData(findUseCasePublicDocument(useCase), getSiteUrl())}
      />
      <article>
        <header>
          <MarketingContainer className={styles.hero}>
            <EditorialBreadcrumb
              items={[
                { href: '/', label: 'The Timeline' },
                { href: USE_CASE_HUB.route, label: 'Use cases' },
                { label: useCase.navLabel },
              ]}
            />

            <div className={styles.heroGrid}>
              <div className={styles.heroCopy}>
                <h1 className={styles.title}>{useCase.title}</h1>
                <p className={styles.summary}>{useCase.summary}</p>
                {useCase.slug === 'crm' ? (
                  <p className={styles.problem}>
                    Timeline keeps its own customer records. External CRM sync is planned, not
                    available today.
                  </p>
                ) : null}
                {useCase.problemLine ? (
                  <p className={styles.problem}>{useCase.problemLine}</p>
                ) : null}
                <div className={styles.actions}>
                  <StartFreeLink className={styles.primaryAction} />
                  <a href="#product-view" className={styles.textAction}>
                    See it in the product <ArrowRight size={16} aria-hidden="true" />
                  </a>
                </div>
              </div>
              <UseCasePreview useCase={useCase} />
            </div>
          </MarketingContainer>
        </header>

        {useCase.howItWorks ? (
          <section className="border-t border-border" aria-labelledby="how-it-works-title">
            <MarketingContainer className={styles.process}>
              <div>
                <h2 id="how-it-works-title" className="text-2xl font-medium tracking-[-0.025em]">
                  {processHeadings[useCase.slug]}
                </h2>
              </div>
              <ol className={styles.steps}>
                {useCase.howItWorks.map((paragraph, index) => (
                  <li key={paragraph}>
                    <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                    <p>{paragraph}</p>
                  </li>
                ))}
              </ol>
            </MarketingContainer>
          </section>
        ) : null}

        <section id="product-view" className={styles.productView} aria-label="Inside The Timeline">
          <MarketingContainer className={styles.section}>
            <div className={styles.sectionIntro}>
              <h2>See the work, with its context.</h2>
              <p>Inside The Timeline · {useCase.navLabel}</p>
            </div>
            {afterSubhead.map((shot) => (
              <MarketingProductScreenshot
                key={shot.file}
                file={shot.file}
                alt={shot.alt}
                caption={shot.caption}
                reshoot={shot.reshoot}
                callouts={shot.callouts}
              />
            ))}
          </MarketingContainer>
        </section>

        {useCase.blocks ? (
          <section>
            <MarketingContainer className={styles.section}>
              <div className={styles.cards}>
                {useCase.blocks.map((block) => (
                  <article key={block.title} className={styles.featureCard}>
                    <h2 className="text-xl font-semibold tracking-[-0.025em]">{block.title}</h2>
                    <p className="mt-4 text-sm leading-7 text-fg-muted">{block.body}</p>
                  </article>
                ))}
              </div>
            </MarketingContainer>
          </section>
        ) : null}

        <section className="border-t border-border">
          <MarketingContainer className={styles.walkthrough}>
            <div>
              <h2 className="text-2xl font-medium tracking-[-0.025em]">
                {useCase.slug === 'work-record' ? 'The Acme rollout, in order.' : 'Put it to work.'}
              </h2>
              {afterHowItWorks.length > 0 ? (
                <div className={styles.exampleBelow}>{exampleCard}</div>
              ) : null}
              {useCase.needs ? (
                <div className={styles.contextItem}>
                  <h3 className="text-lg font-semibold tracking-[-0.02em]">What it needs</h3>
                  <p className="mt-3 text-sm leading-7 text-fg-muted sm:text-base">
                    {useCase.needs}
                  </p>
                </div>
              ) : null}
              {useCase.whoItsFor ? (
                <div className={styles.contextItem}>
                  <h3 className="text-lg font-semibold tracking-[-0.02em]">Who it’s for</h3>
                  <p className="mt-3 text-sm leading-7 text-fg-muted sm:text-base">
                    {useCase.whoItsFor}
                  </p>
                </div>
              ) : null}
              {useCase.boundary ? (
                <div className={styles.contextItem}>
                  <h3 className="text-lg font-semibold tracking-[-0.02em]">What to know</h3>
                  <p className="mt-3 text-sm leading-7 text-fg-muted sm:text-base">
                    {useCase.boundary}
                  </p>
                </div>
              ) : null}
            </div>
            <div className={styles.exampleColumn}>
              {useCase.slug === 'work-record' ? (
                <div>
                  <h3 className="text-xl font-medium tracking-[-0.025em]">
                    Inside a project record
                  </h3>
                  <p className="mt-2 text-sm leading-7 text-fg-muted">
                    The Northstar project below shows the record view. The Acme example alongside it
                    shows how work arrives over time.
                  </p>
                </div>
              ) : null}
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
              {afterHowItWorks.length === 0 ? exampleCard : null}
            </div>
          </MarketingContainer>
        </section>

        <section>
          <MarketingContainer className={styles.faq}>
            <h2 className="text-2xl font-medium tracking-[-0.025em]">Common questions.</h2>
            <div className="divide-y divide-border border-y border-border">
              {useCase.faqs.map((faq) => (
                <details key={faq.question} className="group py-1">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-sm py-5 text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
                    {faq.question}
                    <Plus
                      aria-hidden="true"
                      className="size-4 shrink-0 text-signal group-open:rotate-45"
                    />
                  </summary>
                  <p className="max-w-3xl pb-6 text-sm leading-7 text-fg-muted sm:text-base">
                    {faq.answer}
                  </p>
                </details>
              ))}
            </div>
          </MarketingContainer>
        </section>

        <section className="border-t border-border">
          <MarketingContainer className={styles.section}>
            <h2 className="text-2xl font-medium tracking-[-0.025em]">Related use cases.</h2>
            <div className={styles.related}>
              {related.map((item) => (
                <Link
                  key={item.route}
                  href={item.route}
                  className={`${styles.relatedCard} group outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
                >
                  <h3 className="text-xl font-medium tracking-[-0.025em]">{item.cardTitle}</h3>
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
          </MarketingContainer>
        </section>

        <MarketingCtaBand
          title="Start with the work you want to keep."
          body="Start with a source your team already uses. Keep the context, review proposed changes and build from there."
        />
      </article>
    </main>
  );
}
