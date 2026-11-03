import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { COMPARE_HUB, COMPARE_PAGES } from '@/components/marketing/compare/content';
import { findCompareHubDocument } from '@/components/marketing/compare/public-documents';
import { EditorialKicker } from '@/components/marketing/editorial/editorial-kicker';
import { EditorialSectionHeading } from '@/components/marketing/editorial/editorial-section-heading';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import styles from '@/components/marketing/editorial/editorial.module.css';
import { WORKS_WITH_TOOLS } from '@/components/marketing/integrations/works-with-content';
import { MarketingContainer } from '@/components/marketing/marketing-layout';
import { MarketingCtaBand } from '@/components/marketing/start-free-cta';
import { ProviderLogo } from '@/components/provider-logo';
import { buildPublicStructuredData } from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';

const hubDocument = findCompareHubDocument();

export function CompareHubPage() {
  return (
    <main id="main" tabIndex={-1} data-compare-hub>
      <EditorialStructuredData data={buildPublicStructuredData(hubDocument, getSiteUrl())} />
      <header className="border-b border-border">
        <MarketingContainer className="py-16 sm:py-24 lg:py-28">
          <EditorialKicker>Compare</EditorialKicker>
          <h1 className={`${styles.displayTitle} mt-6`}>{COMPARE_HUB.title}</h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-fg-muted sm:text-xl">
            {COMPARE_HUB.summary}
          </p>
        </MarketingContainer>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <EditorialSectionHeading
          index="Vs"
          title="Head to head"
          intro="Each page cites the competitor's own site. Unverified claims are left out."
        />
        <div className="mt-10 grid gap-px bg-border sm:grid-cols-2">
          {COMPARE_PAGES.map((page) => (
            <Link
              key={page.route}
              href={page.route}
              className="group flex flex-col bg-bg p-6 outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-8"
            >
              <h2 className="text-2xl font-semibold tracking-[-0.035em]">{page.navLabel}</h2>
              <p className="mt-3 grow text-sm leading-7 text-fg-muted">{page.summary}</p>
              <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium">
                Read the comparison
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-1"
                />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <EditorialSectionHeading
            index="With"
            title="Works with"
            intro="These pages live under Integrations. Linear syncs today. Jira and Notion work through MCP lookup. HubSpot, Attio and Pipedrive are coming soon."
          />
          <div className="mt-10 grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
            {WORKS_WITH_TOOLS.map((tool) => (
              <Link
                key={tool.route}
                href={tool.route}
                className="group flex flex-col bg-bg p-6 outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-8"
              >
                <span className="flex items-center gap-3">
                  <ProviderLogo src={tool.logo} size="sm" />
                  <span className="font-mono text-[0.65rem] tracking-[0.14em] text-signal uppercase">
                    {tool.statusLabel}
                  </span>
                </span>
                <h2 className="mt-5 text-2xl font-semibold tracking-[-0.035em]">{tool.name}</h2>
                <p className="mt-3 grow text-sm leading-7 text-fg-muted">{tool.summary}</p>
                <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium">
                  {tool.navLabel}
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
        title="Start with the conversation record."
        body="Link one Slack channel or Telegram group. Keep HubSpot, Jira, Linear or Notion where they are."
      />
    </main>
  );
}
