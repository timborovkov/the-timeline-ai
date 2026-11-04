import Link from 'next/link';

import { EditorialKicker } from '@/components/marketing/editorial/editorial-kicker';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import styles from '@/components/marketing/editorial/editorial.module.css';
import {
  WORKS_WITH_TOOLS,
  type WorksWithTool,
} from '@/components/marketing/integrations/works-with-content';
import { findWorksWithPublicDocument } from '@/components/marketing/integrations/works-with-public-documents';
import { WorksWithGuidance } from '@/components/marketing/integrations/works-with-sections';
import { MarketingCtaBand } from '@/components/marketing/start-free-cta';
import { ProviderLogo } from '@/components/provider-logo';
import { PublicShell } from '@/components/public-shell';
import { buildPublicStructuredData } from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';

export function WorksWithPage({ tool }: { tool: WorksWithTool }) {
  const related = WORKS_WITH_TOOLS.filter((candidate) => candidate.slug !== tool.slug);

  return (
    <PublicShell footerLabel={`${tool.name} and The Timeline`} currentSection="integrations">
      <EditorialStructuredData
        data={buildPublicStructuredData(findWorksWithPublicDocument(tool), getSiteUrl())}
      />
      <main id="main" tabIndex={-1} data-works-with-route={tool.route}>
        <article>
          <header className="border-b border-border">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:py-28">
              <Link
                href="/integrations"
                className="mb-10 inline-flex min-h-10 items-center rounded-sm text-sm font-medium text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                All integrations
              </Link>
              <div className="flex items-center gap-4">
                <ProviderLogo src={tool.logo} size="md" />
                <EditorialKicker>{tool.statusLabel}</EditorialKicker>
              </div>
              <h1 className={`${styles.guideTitle} mt-8`}>{tool.title}</h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-fg-muted sm:text-xl">
                {tool.summary}
              </p>
            </div>
          </header>

          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <section
              className="border-b border-border py-16 sm:py-20"
              aria-labelledby="how-it-plugs-in"
            >
              <div className="grid gap-8 lg:grid-cols-[0.45fr_1fr]">
                <SectionIndex index="How" label="How it plugs in" />
                <div>
                  <h2
                    id="how-it-plugs-in"
                    className="text-3xl font-semibold tracking-tight sm:text-4xl"
                  >
                    How {tool.name} plugs into The Timeline.
                  </h2>
                  <p className="mt-4 max-w-[66ch] text-base leading-relaxed text-fg-muted">
                    {tool.howItPlugsIn}
                  </p>
                </div>
              </div>
            </section>

            <section
              className="border-b border-border py-16 sm:py-20"
              aria-labelledby="status-today"
            >
              <div className="grid gap-8 lg:grid-cols-[0.45fr_1fr]">
                <SectionIndex index="Now" label="Status" />
                <div className="grid gap-8">
                  <div>
                    <h2 id="status-today" className="text-xl font-semibold tracking-[-0.025em]">
                      What works today
                    </h2>
                    <p className="mt-4 max-w-[66ch] text-base leading-relaxed text-fg-muted">
                      {tool.today}
                    </p>
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold tracking-[-0.025em]">What is planned</h2>
                    <p className="mt-4 max-w-[66ch] text-base leading-relaxed text-fg-muted">
                      {tool.later}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <WorksWithGuidance tool={tool} />

            <section
              className="border-b border-border py-16 sm:py-20"
              aria-labelledby="related-tools"
            >
              <div className="grid gap-8 lg:grid-cols-[0.45fr_1fr]">
                <SectionIndex index="Also" label="Other tools" />
                <div>
                  <h2 id="related-tools" className="text-2xl font-semibold tracking-tight">
                    Other tools teams keep.
                  </h2>
                  <div className="mt-7 grid gap-px bg-border sm:grid-cols-2 sm:[&>:last-child:nth-child(odd)]:col-span-2">
                    {related.map((item) => (
                      <Link
                        key={item.route}
                        href={item.route}
                        className="group bg-bg p-6 outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-8"
                      >
                        <p className="font-mono text-[0.65rem] tracking-[0.12em] text-signal uppercase">
                          {item.statusLabel}
                        </p>
                        <h3 className="mt-5 text-xl font-semibold tracking-[-0.025em]">
                          {item.navLabel}
                        </h3>
                        <p className="mt-3 text-sm leading-7 text-fg-muted">{item.summary}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <MarketingCtaBand
            title="Start free with the conversation record."
            body="Link one Slack channel or Telegram group. Keep the rest of the stack where it is."
          />
        </article>
      </main>
    </PublicShell>
  );
}

function SectionIndex({ index, label }: { index: string; label: string }) {
  return (
    <p className="flex items-baseline gap-1.5 text-sm font-medium text-fg-muted">
      <span className="font-mono text-[11px] text-fg-dim">{index}</span>
      <span aria-hidden="true">/</span>
      <span>{label}</span>
    </p>
  );
}
