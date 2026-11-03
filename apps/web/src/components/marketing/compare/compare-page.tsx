import Image from 'next/image';
import Link from 'next/link';

import {
  COMPARE_HUB,
  COMPARE_TOOLS,
  type CompareTool,
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

export function ComparePage({ tool }: { tool: CompareTool }) {
  const related = COMPARE_TOOLS.filter((candidate) => candidate.slug !== tool.slug);

  return (
    <main id="main" tabIndex={-1} data-compare-route={tool.route}>
      <EditorialStructuredData
        data={buildPublicStructuredData(findComparePublicDocument(tool), getSiteUrl())}
      />
      <article>
        <header className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <EditorialBreadcrumb
            items={[
              { href: '/', label: 'The Timeline' },
              { href: COMPARE_HUB.route, label: 'Compare' },
              { label: tool.navLabel },
            ]}
          />

          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-sm border border-border bg-surface">
              <Image src={tool.logo} alt="" width={22} height={22} />
            </span>
            <EditorialKicker>{tool.statusLabel}</EditorialKicker>
          </div>
          <h1 className={`${styles.guideTitle} mt-6`}>{tool.title}</h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-fg-muted sm:text-xl">
            {tool.summary}
          </p>
        </header>

        <section className="border-y border-border bg-surface/45">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[0.42fr_1fr]">
            <EditorialSectionHeading
              index="Keep"
              title={`Keep ${tool.name}.`}
              intro={tool.keepLine}
            />
            <div className="grid gap-8">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.025em]">What works today</h2>
                <p className="mt-4 max-w-3xl text-base leading-8 text-fg-muted">{tool.today}</p>
              </div>
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.025em]">What is planned</h2>
                <p className="mt-4 max-w-3xl text-base leading-8 text-fg-muted">{tool.later}</p>
              </div>
              <p>
                <Link
                  href={tool.relatedHref}
                  className="rounded-sm font-medium text-fg underline decoration-border-strong underline-offset-4 outline-none hover:decoration-fg focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {tool.relatedLabel}
                </Link>
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <EditorialSectionHeading index="Also" title="Other tools teams keep." />
          <div className="mt-10 grid gap-px bg-border sm:grid-cols-2">
            {related.map((item) => (
              <Link
                key={item.route}
                href={item.route}
                className="group bg-bg p-6 outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-8"
              >
                <p className="font-mono text-[0.65rem] tracking-[0.12em] text-signal uppercase">
                  {item.statusLabel}
                </p>
                <h3 className="mt-5 text-xl font-semibold tracking-[-0.025em]">{item.navLabel}</h3>
                <p className="mt-3 text-sm leading-7 text-fg-muted">{item.summary}</p>
              </Link>
            ))}
          </div>
        </section>

        <MarketingCtaBand
          title="Start free with the conversation record."
          body="Link one Slack channel or Telegram group. Keep the rest of the stack where it is."
        />
      </article>
    </main>
  );
}
