import Link from 'next/link';

import { AgentLoopDiagram } from '@/components/marketing/agents/agent-loop-diagram';
import { AgentSetupCard } from '@/components/marketing/agents/agent-setup-card';
import { AGENTS_HUB } from '@/components/marketing/agents/content';
import { AGENTS_HUB_DOCUMENT } from '@/components/marketing/agents/public-documents';
import { ClaudeMcpExample } from '@/components/marketing/claude-mcp-example';
import { EditorialKicker } from '@/components/marketing/editorial/editorial-kicker';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import styles from '@/components/marketing/editorial/editorial.module.css';
import { MarketingContainer, MarketingSectionGrid } from '@/components/marketing/marketing-layout';
import { MarketingProductScreenshot } from '@/components/marketing/product-screenshot';
import publicStyles from '@/components/marketing/public-page.module.css';
import { MarketingSectionIndex } from '@/components/marketing/section-index';
import { MarketingCtaBand } from '@/components/marketing/start-free-cta';
import { TIMELINE_MCP_COMMAND } from '@/lib/agent-install-content';
import { buildPublicStructuredData } from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';

export function AgentsHubPage() {
  return (
    <main id="main" tabIndex={-1} data-agents-hub>
      <EditorialStructuredData
        data={buildPublicStructuredData(AGENTS_HUB_DOCUMENT, getSiteUrl())}
      />
      <header className="border-b border-border">
        <MarketingContainer className="py-10 sm:py-14">
          <div className={publicStyles.heroGrid}>
            <div>
              <EditorialKicker>{AGENTS_HUB.kicker}</EditorialKicker>
              <h1 className={`${styles.displayTitle} mt-6`}>{AGENTS_HUB.title}</h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-fg-muted sm:text-xl">
                {AGENTS_HUB.summary}
              </p>
            </div>
            <div className={publicStyles.agentSetup}>
              <AgentSetupCard />
              <div className="mt-5 max-w-2xl" data-agent-setup-prerequisites>
                <p className="font-mono text-[0.68rem] tracking-[0.14em] text-signal uppercase">
                  {AGENTS_HUB.setupPrerequisite.title}
                </p>
                <p className="mt-3 text-sm leading-7 text-fg-muted sm:text-base">
                  {AGENTS_HUB.setupPrerequisite.body}
                </p>
                <p className="mt-3 text-sm leading-7 text-fg-muted sm:text-base">
                  {AGENTS_HUB.setupPrerequisite.distinction}{' '}
                  <Link
                    href={AGENTS_HUB.setupPrerequisite.mcpHref}
                    className="rounded-sm font-medium text-fg underline decoration-border-strong underline-offset-4 outline-none hover:decoration-fg focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {AGENTS_HUB.setupPrerequisite.mcpLabel}
                  </Link>
                  .
                </p>
              </div>
            </div>
          </div>
          <div className="mt-8">
            <AgentLoopDiagram />
          </div>
          <div className={publicStyles.agentExample}>
            <p className="text-base leading-7 text-fg-muted">
              Claude can ask the same record. The answer keeps the original message, with a link to
              it.
            </p>
            <ClaudeMcpExample />
          </div>
        </MarketingContainer>
      </header>

      <section className="border-b border-border" aria-labelledby="report-in-title">
        <MarketingContainer className="py-10 sm:py-14">
          <MarketingSectionGrid>
            <MarketingSectionIndex
              index={AGENTS_HUB.reportIn.index}
              label={AGENTS_HUB.reportIn.label}
            />
            <div className="min-w-0">
              <h2
                id="report-in-title"
                className="text-3xl font-semibold tracking-tight sm:text-4xl"
              >
                {AGENTS_HUB.reportIn.title}
              </h2>
              <p className="mt-4 max-w-[70ch] text-base leading-7 text-fg-muted">
                {AGENTS_HUB.reportIn.body}
              </p>
              <ul className="mt-6 list-disc space-y-3 pl-5 text-base leading-7 text-fg-muted">
                {AGENTS_HUB.reportIn.paths.map((path) => (
                  <li key={path.name}>
                    {path.name.includes('.') ? (
                      <code className="font-mono text-sm text-fg">{path.name}</code>
                    ) : (
                      <span className="font-medium text-fg">{path.name}</span>
                    )}
                    {` ${path.body}`}
                  </li>
                ))}
              </ul>
              <aside
                className={`${styles.promptBlock} mt-10 rounded-md p-6 sm:p-8`}
                aria-label={AGENTS_HUB.example.label}
              >
                <div className="relative z-10">
                  <p className="font-mono text-[0.68rem] tracking-[0.14em] text-signal uppercase">
                    {AGENTS_HUB.example.label}
                  </p>
                  <h3 className="mt-4 text-xl font-semibold tracking-[-0.025em] sm:text-2xl">
                    {AGENTS_HUB.example.title}
                  </h3>
                  <p className="mt-4 text-sm leading-7 text-fg-muted sm:text-base">
                    {AGENTS_HUB.example.body}
                  </p>
                  <p className="mt-6 border-t border-border pt-5 font-mono text-[0.65rem] leading-5 text-fg-muted">
                    {AGENTS_HUB.example.boundary}
                  </p>
                </div>
              </aside>
            </div>
          </MarketingSectionGrid>
        </MarketingContainer>
      </section>

      <section className="border-b border-border" aria-labelledby="read-out-title">
        <MarketingContainer className="py-10 sm:py-14">
          <div className={publicStyles.detailGrid}>
            <MarketingSectionGrid>
              <MarketingSectionIndex
                index={AGENTS_HUB.readOut.index}
                label={AGENTS_HUB.readOut.label}
              />
              <div className="min-w-0">
                <h2
                  id="read-out-title"
                  className="text-3xl font-semibold tracking-tight sm:text-4xl"
                >
                  {AGENTS_HUB.readOut.title}
                </h2>
                <p className="mt-4 max-w-[70ch] text-base leading-7 text-fg-muted">
                  Compatible clients open{' '}
                  <code className="break-all font-mono text-sm text-fg">
                    {AGENTS_HUB.readOut.endpoint}
                  </code>
                  . {AGENTS_HUB.readOut.body}
                </p>
                <pre className="mt-6 overflow-x-auto rounded-md border border-border bg-surface p-4 font-mono text-xs leading-6">
                  {TIMELINE_MCP_COMMAND}
                </pre>
                <ul className="mt-6 list-disc space-y-3 pl-5 text-base leading-7 text-fg-muted">
                  <li>{AGENTS_HUB.readOut.toolsIntro}</li>
                  {AGENTS_HUB.readOut.facts.map((fact) => (
                    <li key={fact}>{fact}</li>
                  ))}
                </ul>
                <p className="mt-6">
                  <Link
                    href={AGENTS_HUB.installGuide.href}
                    className="rounded-sm font-medium text-fg underline decoration-border-strong underline-offset-4 outline-none hover:decoration-fg focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {AGENTS_HUB.installGuide.label}
                  </Link>
                </p>
              </div>
            </MarketingSectionGrid>
            <div>
              <MarketingProductScreenshot
                file={AGENTS_HUB.screenshot.file}
                alt={AGENTS_HUB.screenshot.alt}
                caption={AGENTS_HUB.screenshot.caption}
              />
            </div>
          </div>
        </MarketingContainer>
      </section>

      <MarketingCtaBand title={AGENTS_HUB.cta.title} body={AGENTS_HUB.cta.body} />
    </main>
  );
}
