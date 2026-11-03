import Link from 'next/link';

import {
  COMPARE_HUB,
  COMPARE_PAGES,
  type ComparePageContent,
} from '@/components/marketing/compare/content';
import { findComparePublicDocument } from '@/components/marketing/compare/public-documents';
import { EditorialBreadcrumb } from '@/components/marketing/editorial/editorial-breadcrumb';
import { EditorialKicker } from '@/components/marketing/editorial/editorial-kicker';
import { EditorialSectionHeading } from '@/components/marketing/editorial/editorial-section-heading';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import styles from '@/components/marketing/editorial/editorial.module.css';
import { MarketingCtaBand } from '@/components/marketing/start-free-cta';
import { buildPublicStructuredData } from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';

export function ComparePage({ page }: { page: ComparePageContent }) {
  const related = COMPARE_PAGES.filter((candidate) => candidate.slug !== page.slug);

  return (
    <main id="main" tabIndex={-1} data-compare-route={page.route}>
      <EditorialStructuredData
        data={buildPublicStructuredData(findComparePublicDocument(page), getSiteUrl())}
      />
      <article>
        <header className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <EditorialBreadcrumb
            items={[
              { href: '/', label: 'The Timeline' },
              { href: COMPARE_HUB.route, label: 'Compare' },
              { label: page.navLabel },
            ]}
          />
          <EditorialKicker>Head to head</EditorialKicker>
          <h1 className={`${styles.guideTitle} mt-6`}>{page.title}</h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-fg-muted sm:text-xl">
            {page.summary}
          </p>
        </header>

        <section className="border-y border-border bg-surface/45">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[0.42fr_1fr]">
            <EditorialSectionHeading
              index="Cite"
              title={`What ${page.name} publishes.`}
              intro={`Every ${page.name} fact below links to ${page.name}'s own site.`}
            />
            <ul className="grid gap-8">
              {page.facts.map((fact) => (
                <li key={fact.claim}>
                  <p className="max-w-3xl text-base leading-8 text-fg">{fact.claim}</p>
                  <p className="mt-3">
                    <a
                      href={fact.source.href}
                      className="rounded-sm font-medium text-fg underline decoration-border-strong underline-offset-4 outline-none hover:decoration-fg focus-visible:ring-2 focus-visible:ring-ring"
                      rel="noreferrer"
                    >
                      Source: {fact.source.label}
                    </a>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.42fr_1fr]">
            <EditorialSectionHeading
              index="Timeline"
              title="What The Timeline is."
              intro={page.timelineSide}
            />
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.025em]">
                When {page.name} is the better pick
              </h2>
              <p className="mt-4 max-w-3xl text-base leading-8 text-fg-muted">
                {page.whenCompetitorBetter}{' '}
                <a
                  href={page.competitorUrl}
                  className="rounded-sm font-medium text-fg underline decoration-border-strong underline-offset-4 outline-none hover:decoration-fg focus-visible:ring-2 focus-visible:ring-ring"
                  rel="noreferrer"
                >
                  Read {page.name}'s site
                </a>
                .
              </p>
            </div>
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
            <EditorialSectionHeading index="Also" title="Other comparisons." />
            <div className="mt-10 grid gap-px bg-border sm:grid-cols-2">
              {related.map((item) => (
                <Link
                  key={item.route}
                  href={item.route}
                  className="group bg-bg p-6 outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-8"
                >
                  <h3 className="text-xl font-semibold tracking-[-0.025em]">{item.navLabel}</h3>
                  <p className="mt-3 text-sm leading-7 text-fg-muted">{item.summary}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <MarketingCtaBand
          title="Start free with the conversation record."
          body="Link one Slack channel or Telegram group. Compare the rest of the stack on its own terms."
        />
      </article>
    </main>
  );
}
