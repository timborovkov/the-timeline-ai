import Link from 'next/link';

import { AgentLoopDiagram } from '@/components/marketing/agents/agent-loop-diagram';
import { AgentSetupCard } from '@/components/marketing/agents/agent-setup-card';
import styles from '@/components/marketing/agents/agents-hub.module.css';
import { AGENTS_HUB } from '@/components/marketing/agents/content';
import { AGENTS_HUB_DOCUMENT } from '@/components/marketing/agents/public-documents';
import { ClaudeMcpExample } from '@/components/marketing/claude-mcp-example';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import { MarketingContainer } from '@/components/marketing/marketing-layout';
import { MarketingProductScreenshot } from '@/components/marketing/product-screenshot';
import { MarketingCtaBand } from '@/components/marketing/start-free-cta';
import { TIMELINE_MCP_COMMAND } from '@/lib/agent-install-content';
import { buildPublicStructuredData } from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';

export function AgentsHubPage() {
  return (
    <main id="main" tabIndex={-1} data-agents-hub className={styles.page}>
      <EditorialStructuredData
        data={buildPublicStructuredData(AGENTS_HUB_DOCUMENT, getSiteUrl())}
      />
      <MarketingContainer>
        <header className={styles.hero}>
          <div>
            <h1>{AGENTS_HUB.title}</h1>
            <p className={styles.summary}>{AGENTS_HUB.summary}</p>
            <AgentSetupCard compact className={styles.setup} />
            <p className={styles.setupNote}>
              Sign in or create an account, choose your team, and approve access in the browser.
            </p>
            <a href="#agent-access" className={styles.textLink}>
              How access works
            </a>
          </div>
          <AgentLoopDiagram />
        </header>

        <section className={styles.proof} aria-labelledby="agent-proof-title">
          <div>
            <h2 id="agent-proof-title">The context is already there.</h2>
            <p>
              Your agent can find decisions, owners and commitments in the same record your team
              uses. The sources come with it.
            </p>
            <p>
              This illustrative Claude exchange follows a customer commitment back to its email and
              call transcript.
            </p>
          </div>
          <ClaudeMcpExample />
        </section>

        <section className={styles.contribute} aria-labelledby="report-in-title">
          <div>
            <h2 id="report-in-title">{AGENTS_HUB.reportIn.title}</h2>
            <p>{AGENTS_HUB.reportIn.body}</p>
            <dl className={styles.paths}>
              {AGENTS_HUB.reportIn.paths.map((path) => (
                <div key={path.name}>
                  <dt>{path.name.includes('.') ? <code>{path.name}</code> : path.name}</dt>
                  <dd>{path.body}</dd>
                </div>
              ))}
            </dl>
          </div>
          <aside className={styles.note} aria-label={AGENTS_HUB.example.label}>
            <h3>{AGENTS_HUB.example.title}</h3>
            <blockquote>
              “The migration callback is ready for review. I’ve left the checklist with Priya.”
            </blockquote>
            <p>{AGENTS_HUB.example.body}</p>
            <p className={styles.boundary}>{AGENTS_HUB.example.boundary}</p>
          </aside>
        </section>

        <section id="agent-access" className={styles.access} aria-labelledby="read-out-title">
          <div className={styles.accessHeading}>
            <h2 id="read-out-title">{AGENTS_HUB.readOut.title}</h2>
            <div data-agent-setup-prerequisites>
              <h3>{AGENTS_HUB.setupPrerequisite.title}</h3>
              <p>{AGENTS_HUB.setupPrerequisite.body}</p>
              <p>
                {AGENTS_HUB.setupPrerequisite.distinction}{' '}
                <Link href={AGENTS_HUB.setupPrerequisite.mcpHref}>
                  {AGENTS_HUB.setupPrerequisite.mcpLabel}
                </Link>
                .
              </p>
            </div>
          </div>
          <MarketingProductScreenshot
            file={AGENTS_HUB.screenshot.file}
            alt={AGENTS_HUB.screenshot.alt}
            caption={AGENTS_HUB.screenshot.caption}
          />
          <details className={styles.technical}>
            <summary>Manual connection, tools and permissions</summary>
            <p>
              Compatible clients open <code>{AGENTS_HUB.readOut.endpoint}</code>.{' '}
              {AGENTS_HUB.readOut.body}
            </p>
            <pre>{TIMELINE_MCP_COMMAND}</pre>
            <ul>
              <li>{AGENTS_HUB.readOut.toolsIntro}</li>
              {AGENTS_HUB.readOut.facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          </details>
          <Link className={styles.textLink} href={AGENTS_HUB.installGuide.href}>
            {AGENTS_HUB.installGuide.label}
          </Link>
        </section>
      </MarketingContainer>
      <MarketingCtaBand title={AGENTS_HUB.cta.title} body={AGENTS_HUB.cta.body} />
    </main>
  );
}
