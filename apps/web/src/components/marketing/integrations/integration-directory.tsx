import { ArrowRight, Globe, Mail, Video, Webhook } from 'lucide-react';
import Link from 'next/link';

import {
  CAPTURE_SURFACES,
  type CaptureSurfaceContent,
} from '@/components/marketing/integrations/capture-surface-content';
import {
  CONNECTORS,
  getConnectorCapabilityTiers,
} from '@/components/marketing/integrations/connector-content';
import { DirectoryStructuredData } from '@/components/marketing/integrations/connector-seo';
import styles from '@/components/marketing/integrations/integration-directory.module.css';
import { RecordsToAnswer } from '@/components/marketing/integrations/records-to-answer';
import { WORKS_WITH_TOOLS } from '@/components/marketing/integrations/works-with-content';
import { MarketingContainer } from '@/components/marketing/marketing-layout';
import publicStyles from '@/components/marketing/public-page.module.css';
import { ProviderLogo } from '@/components/provider-logo';
import { PublicSessionBranch } from '@/components/public-session-branch';
import { PublicShell } from '@/components/public-shell';
import { Button } from '@/components/ui/button';

const CAPTURE_ORDER = ['telegram', 'slack-chat', 'email', 'meetings', 'webhooks', 'websites'];
const surfaces = [...CAPTURE_SURFACES].sort(
  (a, b) => CAPTURE_ORDER.indexOf(a.id) - CAPTURE_ORDER.indexOf(b.id),
);

export function IntegrationDirectory() {
  const featuredConnector = CONNECTORS.find((connector) => connector.slug === 'slack');
  if (!featuredConnector) throw new Error('Native Slack connector content is required');
  const tiers = getConnectorCapabilityTiers();
  return (
    <PublicShell width="wide" footerLabel="The Timeline integrations" currentSection="integrations">
      <DirectoryStructuredData />
      <main id="main" tabIndex={-1}>
        <MarketingContainer className={styles.directory}>
          <header className={styles.header}>
            <h1 className={publicStyles.connectorTitle}>
              Connect the places where the work already happens.
            </h1>
            <p>
              Start with a Slack conversation or Telegram group. Add selected tool history or live
              lookup when you need it.
            </p>
            <PublicSessionBranch
              signedOut={
                <Button asChild size="lg">
                  <Link href="/sign-up">
                    Start free
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              }
              signedIn={
                <Button asChild size="lg">
                  <Link href="/app/connections">
                    Open connections
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              }
            />
          </header>
          <nav className={styles.jumpLinks} aria-label="Integration categories">
            <a href="#capture-surfaces">Conversations & capture</a>
            <a href="#native">Native sync</a>
            <a href="#live-lookup">Live lookup</a>
            <a href="#planned">Coming later</a>
          </nav>
          <section className={styles.section} aria-labelledby="capture-surfaces">
            <h2 id="capture-surfaces">Start where the conversation already happens.</h2>
            <p>Send work in deliberately. Each route explains what is saved and who can see it.</p>
            <div className={styles.rows}>
              {surfaces.map((surface) => (
                <CaptureSurfaceRow key={surface.id} surface={surface} />
              ))}
            </div>
          </section>
          <section className={styles.section} aria-labelledby="native">
            <h2 id="native">Bring selected tool history into Timeline.</h2>
            <p>
              Connect your tools, choose the sources to share, and have a team admin activate them.
            </p>
            <div className={styles.rows}>
              {CONNECTORS.map((connector) => (
                <Link
                  key={connector.slug}
                  href={`/integrations/${connector.slug}`}
                  className={styles.providerRow}
                >
                  <ProviderLogo src={connector.logo} size="md" />
                  <div>
                    <h3>{connector.name === 'Slack' ? 'Slack history' : connector.name}</h3>
                    <p>{connector.intro}</p>
                  </div>
                  <span className={styles.status}>
                    Native sync
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </span>
                </Link>
              ))}
            </div>
          </section>
          <section className={styles.section} aria-labelledby="live-lookup">
            <h2 id="live-lookup">Look up live tools</h2>
            <p>
              Enabled MCP tools answer questions from the source. They do not import or sync tool
              history into Timeline.
            </p>
            <Link href="/integrations/mcp" className={styles.textLink}>
              Connect MCP tools
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
            <div className={styles.rows}>
              {WORKS_WITH_TOOLS.filter((tool) => tool.status === 'mcp-lookup').map((tool) => (
                <ToolRow key={tool.slug} tool={tool} />
              ))}
            </div>
            <details className={styles.context}>
              <summary>All live and local tool connections</summary>
              <p>{tiers.mcpAccess.join(', ')}</p>
              <h3>Use a local desktop connection</h3>
              <p>
                {tiers.localDesktopAccess.join(', ')}. Available only when Timeline runs on the same
                machine; not connectable from hosted Timeline.
              </p>
            </details>
          </section>
          <section className={styles.section} aria-labelledby="planned">
            <h2 id="planned">Coming later</h2>
            <p>
              These planned native integrations cannot be connected yet. Where live lookup is
              available, it is listed separately above.
            </p>
            <div className={styles.rows}>
              {WORKS_WITH_TOOLS.filter((tool) => tool.status === 'coming-soon').map((tool) => (
                <ToolRow key={tool.slug} tool={tool} />
              ))}
            </div>
            <details className={styles.context}>
              <summary>All planned native integrations</summary>
              <p>{tiers.plannedProviders.join(', ')}</p>
            </details>
          </section>
          <section className={styles.section} aria-labelledby="evidence">
            <h2 id="evidence">Every connector has a specific evidence story.</h2>
            <p>
              Timeline orders selected records by time, keeps their source attached, and cites the
              evidence used in the answer. This Slack example shows that journey from conversation
              to chronology.
            </p>
            <div className="mt-6">
              <RecordsToAnswer connector={featuredConnector} compact />
            </div>
          </section>
        </MarketingContainer>
      </main>
    </PublicShell>
  );
}

function ToolRow({ tool }: { tool: (typeof WORKS_WITH_TOOLS)[number] }) {
  return (
    <Link href={tool.route} className={styles.providerRow}>
      <ProviderLogo src={tool.logo} size="md" />
      <div>
        <h3>{tool.name}</h3>
        <p>{tool.summary}</p>
      </div>
      <span className={styles.status}>
        {tool.statusLabel}
        <ArrowRight aria-hidden="true" className="size-4" />
      </span>
    </Link>
  );
}

function CaptureSurfaceRow({ surface }: { surface: CaptureSurfaceContent }) {
  return (
    <article className={styles.captureRow}>
      <CaptureSurfaceIcon surface={surface} />
      <div>
        <h3>{surface.name}</h3>
        <p>{surface.summary}</p>
        <details className={styles.captureDetails}>
          <summary>Capture details and limits</summary>
          <p>{surface.category}</p>
          <dl>
            <dt>Timeline captures</dt>
            <dd>{surface.captured}</dd>
            <dt>What to know</dt>
            <dd>{surface.boundary}</dd>
          </dl>
        </details>
      </div>
      <PublicSessionBranch
        signedOut={
          <Link className={styles.captureAction} href={surface.publicHref ?? '/sign-up'}>
            {`Start with ${surface.name}`}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        }
        signedIn={
          <Link className={styles.captureAction} href={surface.setupHref}>
            {surface.setupLabel}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        }
      />
    </article>
  );
}

function CaptureSurfaceIcon({ surface }: { surface: CaptureSurfaceContent }) {
  if (surface.icon === 'telegram' || surface.icon === 'slack') {
    return (
      <ProviderLogo
        src={`/connectors/${surface.icon === 'telegram' ? 'telegram' : 'slack'}.svg`}
        size="md"
      />
    );
  }

  const Icon =
    surface.icon === 'globe'
      ? Globe
      : surface.icon === 'mail'
        ? Mail
        : surface.icon === 'video'
          ? Video
          : Webhook;
  return (
    <div className="grid size-12 place-items-center rounded-md border border-border bg-surface">
      <Icon aria-hidden="true" className="size-6 text-fg" strokeWidth={1.5} />
    </div>
  );
}
