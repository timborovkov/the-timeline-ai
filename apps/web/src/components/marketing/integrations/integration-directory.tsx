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
import { WORKS_WITH_TOOLS } from '@/components/marketing/integrations/works-with-content';
import { MarketingContainer } from '@/components/marketing/marketing-layout';
import { ProviderLogo } from '@/components/provider-logo';
import { PublicSessionBranch } from '@/components/public-session-branch';
import { PublicShell } from '@/components/public-shell';
import { Button } from '@/components/ui/button';

const CONNECTOR_SUMMARIES: Record<string, string> = {
  slack: 'Selected channel messages, threads and file-share metadata.',
  github: 'Issues, pull requests, reviews, releases and commits.',
  linear: 'Issues, projects and comments, with their history connected.',
  'google-drive': 'Selected documents and their context, with supported file text.',
  monday: 'Boards, items and updates connected to the surrounding work.',
  sentry: 'Issues, alerts and releases alongside the code and discussion.',
};

const CAPTURE_ORDER = ['telegram', 'slack-chat', 'email', 'meetings', 'webhooks', 'websites'];
const surfaces = [...CAPTURE_SURFACES].sort(
  (a, b) => CAPTURE_ORDER.indexOf(a.id) - CAPTURE_ORDER.indexOf(b.id),
);

export function IntegrationDirectory() {
  const tiers = getConnectorCapabilityTiers();
  return (
    <PublicShell width="wide" footerLabel="The Timeline integrations" currentSection="integrations">
      <DirectoryStructuredData />
      <main id="main" tabIndex={-1}>
        <MarketingContainer className={styles.directory}>
          <header className={styles.header}>
            <div>
              <h1 className={styles.title}>Your tools. One work record.</h1>
              <p>
                Bring selected sources into a shared work record. Connect the tools you use, send
                work in, or give Timeline access to live tools when you need them.
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
            </div>
            <nav className={styles.choices} aria-label="Integration categories">
              <a href="#capture-surfaces">
                <strong>Send work in</strong>
                <span>Messages, files, calls and websites you choose to capture.</span>
                <ArrowRight aria-hidden="true" size={20} />
              </a>
              <a href="#native">
                <strong>Sync selected history</strong>
                <span>Six native integrations, with source records kept together.</span>
                <ArrowRight aria-hidden="true" size={20} />
              </a>
              <a href="#live-lookup">
                <strong>Look up live tools</strong>
                <span>Current information through MCP, without importing history.</span>
                <ArrowRight aria-hidden="true" size={20} />
              </a>
              <a href="#planned" className={styles.plannedLink}>
                See what’s planned <ArrowRight aria-hidden="true" size={16} />
              </a>
            </nav>
          </header>

          <section className={styles.section} aria-labelledby="capture-surfaces">
            <h2 id="capture-surfaces">Send work in. Keep the context.</h2>
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
                    <p>{CONNECTOR_SUMMARIES[connector.slug]}</p>
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
