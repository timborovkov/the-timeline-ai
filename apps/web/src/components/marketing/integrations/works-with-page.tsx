import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import styles from '@/components/marketing/integrations/integration-detail.module.css';
import {
  WORKS_WITH_TOOLS,
  type WorksWithTool,
} from '@/components/marketing/integrations/works-with-content';
import { findWorksWithPublicDocument } from '@/components/marketing/integrations/works-with-public-documents';
import { WorksWithGuidance } from '@/components/marketing/integrations/works-with-sections';
import { MarketingContainer } from '@/components/marketing/marketing-layout';
import { MarketingCtaBand } from '@/components/marketing/start-free-cta';
import { ProviderLogo } from '@/components/provider-logo';
import { PublicShell } from '@/components/public-shell';
import { buildPublicStructuredData } from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';

export function WorksWithPage({ tool }: { tool: WorksWithTool }) {
  const related = WORKS_WITH_TOOLS.filter((candidate) => candidate.slug !== tool.slug);
  const live = tool.status === 'mcp-lookup';
  return (
    <PublicShell footerLabel={`${tool.name} and The Timeline`} currentSection="integrations">
      <EditorialStructuredData
        data={buildPublicStructuredData(findWorksWithPublicDocument(tool), getSiteUrl())}
      />
      <main id="main" tabIndex={-1} data-works-with-route={tool.route}>
        <article>
          <header>
            <MarketingContainer className={styles.hero}>
              <Link href="/integrations" className={styles.back}>
                All integrations
              </Link>
              <div className={styles.heroGrid}>
                <div>
                  <div className={styles.identity}>
                    <ProviderLogo src={tool.logo} size="md" />
                    <span>
                      {tool.name} · {tool.statusLabel}
                    </span>
                  </div>
                  <h1 className={styles.title}>{tool.title}</h1>
                  <p className={styles.intro}>{tool.summary}</p>
                  <div className={styles.actions}>
                    <Link
                      href={live ? '/integrations/mcp' : '/integrations#capture-surfaces'}
                      className="inline-flex min-h-12 items-center gap-3 rounded-sm bg-signal px-5 font-semibold text-signal-fg"
                    >
                      {live ? 'Explore MCP setup' : 'Explore available sources'}
                      <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                  </div>
                  <p className={styles.note}>
                    {live
                      ? 'Live tool access is separate from native sync.'
                      : `Native ${tool.name} sync is not available today.`}
                  </p>
                </div>
                <div className={styles.preview}>
                  <div className={styles.status}>
                    <div>
                      <h2>What works today</h2>
                      <p>{tool.today}</p>
                    </div>
                    <div>
                      <h2>What is planned</h2>
                      <p>{tool.later}</p>
                    </div>
                  </div>
                </div>
              </div>
            </MarketingContainer>
          </header>
          <MarketingContainer>
            <section className={styles.section} aria-labelledby="how-it-plugs-in">
              <div className={styles.split}>
                <h2 id="how-it-plugs-in">Where {tool.name} fits.</h2>
                <div>
                  <p className="text-base leading-7 text-fg-muted">{tool.howItPlugsIn}</p>
                  {live ? (
                    <Link
                      href="/integrations/mcp"
                      className="mt-5 inline-flex min-h-11 items-center gap-2 underline underline-offset-4"
                    >
                      Connect MCP tools <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                  ) : null}
                </div>
              </div>
            </section>
            <WorksWithGuidance tool={tool} />
            <section className={styles.section} aria-labelledby="related-tools">
              <h2 id="related-tools">The rest of your stack.</h2>
              <div className="mt-6 divide-y divide-border">
                {related.map((item) => (
                  <Link
                    key={item.route}
                    href={item.route}
                    className="group flex min-h-20 items-center justify-between gap-4 py-4 hover:text-signal focus-visible:outline-2"
                  >
                    <span className="flex items-center gap-4">
                      <ProviderLogo src={item.logo} size="sm" />
                      <span className="font-medium">{item.name}</span>
                    </span>
                    <span className="flex items-center gap-3 text-sm text-fg-muted">
                      {item.statusLabel}
                      <ArrowRight size={16} aria-hidden="true" />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          </MarketingContainer>
          <MarketingCtaBand
            title="Start with the sources you already use."
            body="Build a shared work record around your team’s tools, with sources attached and lasting changes you approve."
          />
        </article>
      </main>
    </PublicShell>
  );
}
