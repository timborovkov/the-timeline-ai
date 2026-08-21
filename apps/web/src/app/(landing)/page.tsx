import * as integrationsLib from '@timeline/shared/integrations/registry';
import { Mail, Video, Webhook } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { LandingSkipLink } from '@/app/(landing)/_landing-skip-link';
import styles from '@/app/(landing)/home.module.css';
import { Logo } from '@/components/brand/logo';
import { GitHubSourceLink } from '@/components/github-source-link';
import { HomeMotion } from '@/components/marketing/home/home-motion';
import { TimelineFlowDiagram } from '@/components/marketing/home/timeline-flow-diagram';
import { CAPTURE_SURFACES } from '@/components/marketing/integrations/capture-surface-content';
import { findConnectorByName } from '@/components/marketing/integrations/connector-content';
import {
  PUBLIC_DEMO_STORY,
} from '@/components/marketing/public-demo-story';
import { SOLUTION_ROUTES } from '@/components/marketing/solutions/content';
import { PublicHeader } from '@/components/public-header';
import { PublicNavigationItems } from '@/components/public-navigation';
import { auth } from '@/lib/auth';
import { getLegalContactEmail } from '@/lib/legal-versions';
import {
  PUBLIC_DOCUMENT_REGISTRY,
  buildPublicStructuredData,
  metadataForPublicDocument,
  stringifyJsonLdForHtml,
} from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';
import { cn } from '@/lib/utils';

const SITE_NAME = 'The Timeline';
const CONTACT_HREF = '/help/support';
const HOME_DOCUMENT = getHomeDocument();

export const metadata: Metadata = {
  ...metadataForPublicDocument(HOME_DOCUMENT),
  keywords: [
    'AI team memory',
    'project memory',
    'project history',
    'cited AI answers',
    'cross-tool knowledge base',
    'meeting transcript search',
    'project status AI',
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-snippet': -1, 'max-image-preview': 'large' },
  },
};

function getHomeDocument() {
  const document = PUBLIC_DOCUMENT_REGISTRY.get('/');
  if (!document) throw new Error('The public document registry is missing the landing page');
  return document;
}

const ACME_EVENTS = PUBLIC_DEMO_STORY.landing.events;

const AUDIENCES = [
  {
    index: '01',
    name: 'Client delivery',
    outcome: 'Transfer the decisions, blockers, owners, and commitments with their sources.',
    result: 'Current handoff',
    href: SOLUTION_ROUTES.clientProjectHandoffs,
  },
  {
    index: '02',
    name: 'Sales and account teams',
    outcome: 'Keep people, company, deal, and follow-up context tied to the conversation.',
    result: 'Cited account context',
    href: SOLUTION_ROUTES.crmContextFromTeamActivity,
  },
  {
    index: '03',
    name: 'Product and engineering',
    outcome: 'Turn the week’s discussion, issue state, code, and releases into one update.',
    result: 'Weekly status',
    href: SOLUTION_ROUTES.weeklyProjectUpdates,
  },
] as const;

const TRUST_STEPS = [
  {
    index: '01',
    title: 'Evidence arrives',
    detail: 'Telegram / linked launch group',
  },
  {
    index: '02',
    title: 'Original stays intact',
    detail: 'Captured source / immutable',
  },
  {
    index: '03',
    title: 'Access is checked',
    detail: 'Team + event visibility',
  },
  {
    index: '04',
    title: 'Suggested changes wait',
    detail: 'Human approval required',
  },
] as const;

interface NativeConnector {
  label: string;
  logo: string;
  lightLogoTileInDarkMode: boolean;
  state: 'available' | 'setup-required';
  href?: `/integrations/${string}`;
}

export default async function LandingPage() {
  const session = await auth();
  const isSignedIn = Boolean(session?.user);
  const nativeConnectors: NativeConnector[] = [];
  for (const connector of integrationsLib.listCatalog()) {
    if (connector.kind !== 'native' || connector.ingestStatus !== 'implemented') continue;
    const publicConnector = findConnectorByName(connector.label);
    const href = publicConnector ? (`/integrations/${publicConnector.slug}` as const) : undefined;
    if (!publicConnector) continue;
    if (connector.status === 'native_available') {
      nativeConnectors.push({
        label: connector.label,
        logo: publicConnector.logo,
        lightLogoTileInDarkMode: publicConnector.lightLogoTileInDarkMode,
        state: 'available',
        href,
      });
    }
    if (connector.status === 'native_unconfigured') {
      nativeConnectors.push({
        label: connector.label,
        logo: publicConnector.logo,
        lightLogoTileInDarkMode: publicConnector.lightLogoTileInDarkMode,
        state: 'setup-required',
        href,
      });
    }
  }

  return (
    <div className={styles.page} data-home-root>
      <StructuredData />
      <HomeMotion />
      <div className={styles.skipLayer}>
        <LandingSkipLink />
      </div>
      <div className={styles.progress} aria-hidden="true">
        <span />
      </div>
      <PublicHeader isSignedIn={isSignedIn} currentSection="product" />
      <main id="main" tabIndex={-1}>
        <ClaimScene isSignedIn={isSignedIn} />
        <ChronologyScene nativeConnectors={nativeConnectors} />
        <AnswerScene />
        <TrustScene />
        <CtaScene isSignedIn={isSignedIn} />
      </main>
      <Footer isSignedIn={isSignedIn} />
    </div>
  );
}

function StructuredData() {
  const legalContactEmail = getLegalContactEmail();
  const siteUrl = getSiteUrl();
  const publicGraph = buildPublicStructuredData(HOME_DOCUMENT, siteUrl);
  const orgId = new URL('/#organization', siteUrl).toString();
  const siteId = new URL('/#website', siteUrl).toString();
  const appId = new URL('/#software', siteUrl).toString();
  const organization: Record<string, string> = {
    '@type': 'Organization',
    '@id': orgId,
    name: SITE_NAME,
    url: siteUrl,
    logo: new URL('/icon.svg', siteUrl).toString(),
  };
  if (legalContactEmail) organization.email = legalContactEmail;

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      organization,
      {
        '@type': 'WebSite',
        '@id': siteId,
        url: siteUrl,
        name: SITE_NAME,
        description: HOME_DOCUMENT.description,
        publisher: { '@id': orgId },
      },
      ...publicGraph['@graph'].map((node) => {
        if (node['@type'] === 'WebPage') {
          return { ...node, isPartOf: { '@id': siteId }, about: { '@id': appId } };
        }
        if (node['@type'] === 'SoftwareApplication') {
          return { ...node, '@id': appId, publisher: { '@id': orgId } };
        }
        return node;
      }),
    ],
  };

  return (
    // react-doctor-disable-next-line react-doctor/no-danger, react-doctor/dangerous-html-sink
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: stringifyJsonLdForHtml(graph) }}
    />
  );
}

function ClaimScene({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <section
      className={cn(styles.scene, styles.claimScene)}
      aria-labelledby="claim-title"
      data-scene="01-claim"
    >
      <div className={styles.heroCopy} data-home-reveal>
        <SceneIndex number="01" label="AI team memory" />
        <h1 id="claim-title" className={styles.heroTitle}>
          Scattered work. <em>Cited answers.</em>
        </h1>
        <p className={styles.heroIntro}>
          Timeline is AI team memory for real projects. It preserves the messages, meetings,
          documents, tickets, and code you choose in one chronological record. Ask what happened,
          what changed, and what comes next—then trace each claim back to the source.
        </p>
        <div className={styles.heroActions}>
          <Link href={isSignedIn ? '/app' : '/sign-up'} className={styles.primaryCta}>
            {isSignedIn ? 'Go to dashboard' : 'Try one real project'} <span aria-hidden>→</span>
          </Link>
          <Link href="/how-it-works" className={styles.textLink}>
            See how Timeline works
          </Link>
        </div>
        {isSignedIn ? null : (
          <p className={styles.ctaFinePrint}>
            Free to start · no card required ·{' '}
            <Link href="/pricing" className={styles.textLink}>
              See pricing
            </Link>
          </p>
        )}
        <div className={styles.heroSourceLink}>
          <GitHubSourceLink />
        </div>
      </div>

      <TimelineFlowDiagram variant="hero" />
    </section>
  );
}

function ChronologyScene({ nativeConnectors }: { nativeConnectors: NativeConnector[] }) {
  return (
    <section
      id="sources"
      className={styles.scene}
      aria-labelledby="chronology-title"
      data-scene="02-chronology"
    >
      <SceneHeading
        number="02"
        label="Evidence → chronology"
        id="chronology-title"
        title={
          <>
            Status should not require an <em>investigation.</em>
          </>
        }
        copy="Work can begin in a linked Telegram group or Slack channel, then spread through meetings, documents, tickets, code, automations, and email. Rebuilding status, handoffs, customer commitments, and decisions becomes slow—and the result is easy to get wrong. Timeline preserves source, time, and visibility in the project record."
      />
      <div className={styles.timelineStage} data-home-diagram>
        <div className={styles.timelineHeader}>
          <span>Acme rollout / Last 7 days</span>
          <span>5 evidence items</span>
        </div>
        <ol className={styles.timelineList}>
          {ACME_EVENTS.map((event) => (
            <li key={event.id} id={`acme-source-${event.id}`}>
              <time dateTime={event.dateTime}>
                <span>{event.day.slice(0, 3)}</span>
                {event.time}
              </time>
              <div className={styles.timelineNode} aria-hidden="true">
                <span />
              </div>
              <article>
                <div>
                  <span className={styles.sourceId}>[{event.id}]</span>
                  <span className={styles.sourceName}>{event.source}</span>
                </div>
                <h3>{event.title}</h3>
                <p>{event.detail}</p>
              </article>
            </li>
          ))}
        </ol>
        <aside className={styles.chronologyContract} aria-label="Source handling">
          <span className={styles.monoLabel}>What Timeline preserves</span>
          <dl>
            <div>
              <dt>Content</dt>
              <dd>Kept as received</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>Placed on one chronology</dd>
            </div>
            <div>
              <dt>Visibility</dt>
              <dd>Carried into every answer</dd>
            </div>
          </dl>
        </aside>
      </div>
      <ConnectorRail nativeConnectors={nativeConnectors} />
    </section>
  );
}

function ConnectorRail({ nativeConnectors }: { nativeConnectors: NativeConnector[] }) {
  return (
    <aside className={styles.connectorPanel} data-home-diagram aria-labelledby="connector-title">
      <header>
        <span className={styles.monoLabel}>Where evidence enters</span>
        <div>
          <h3 id="connector-title">Two ways in. One cited record.</h3>
          <p>
            Deliberately send work to Timeline, or sync selected records from the systems that
            already hold it. Both paths preserve the source and its evidence boundary.
          </p>
        </div>
      </header>
      <div className={styles.connectorPaths}>
        <article className={styles.connectorPath}>
          <span className={styles.monoLabel}>Messages and files</span>
          <h4>Send the work to Timeline.</h4>
          <p>
            Link a Telegram group or Slack channel, forward mail, add a meeting transcript or file,
            or post an authenticated webhook event. A direct chat asks the agent; it is not passive
            history capture.
          </p>
          <ul className={styles.captureSurfaceList} aria-label="Ways to send work to Timeline">
            {CAPTURE_SURFACES.map((surface) => (
              <li key={surface.id}>
                <HomeCaptureSurfaceIcon icon={surface.icon} />
                <span>{surface.name}</span>
              </li>
            ))}
          </ul>
        </article>
        <article className={styles.connectorPath}>
          <span className={styles.monoLabel}>Connected tools</span>
          <h4>Sync selected records.</h4>
          <p>
            Choose which provider records belong in Timeline. The original tool remains the source,
            and every captured event links back to it.
          </p>
          {nativeConnectors.length > 0 ? (
            <ul className={styles.nativeConnectorList} aria-label="Native provider connectors">
              {nativeConnectors.map((connector) => (
                <li key={connector.label}>
                  <Link href={connector.href ?? '/integrations'}>
                    <span
                      className={cn(
                        styles.connectorLogoTile,
                        connector.lightLogoTileInDarkMode && styles.connectorLogoTileLight,
                      )}
                    >
                      <Image src={connector.logo} alt="" width={20} height={20} />
                    </span>
                    <span>{connector.label}</span>
                    <small>
                      {connector.state === 'available' ? 'Ready to connect' : 'Admin setup needed'}
                    </small>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.connectorEmpty}>No native OAuth connectors are configured.</p>
          )}
        </article>
      </div>
      <div className={styles.connectorFooter}>
        <p>
          Timeline can also use enabled custom MCP tools when you ask a question without adding
          their history to the record. Some local and upcoming connections are not available in the
          hosted app yet.
        </p>
        <Link href="/integrations" className={styles.textLink}>
          Explore integrations <span aria-hidden="true">→</span>
        </Link>
      </div>
    </aside>
  );
}

function HomeCaptureSurfaceIcon({ icon }: { icon: (typeof CAPTURE_SURFACES)[number]['icon'] }) {
  if (icon === 'telegram' || icon === 'slack') {
    return (
      <span className={cn(styles.captureSurfaceIcon, styles.captureSurfaceIconBrand)}>
        <Image src={`/connectors/${icon}.svg`} alt="" width={18} height={18} />
      </span>
    );
  }
  const Icon = icon === 'mail' ? Mail : icon === 'video' ? Video : Webhook;
  return (
    <span className={styles.captureSurfaceIcon}>
      <Icon aria-hidden="true" size={16} strokeWidth={1.6} />
    </span>
  );
}

function AnswerScene() {
  return (
    <section
      id="answer"
      className={styles.scene}
      aria-labelledby="answer-title"
      data-scene="03-answer"
    >
      <SceneHeading
        number="03"
        label="Cited answer"
        id="answer-title"
        title={
          <>
            Meaning resolves. The receipts <em>stay attached.</em>
          </>
        }
        copy="Ask the question you normally answer by searching four tools and messaging three people."
      />
      <div className={styles.answerLayout} data-home-diagram>
        <article className={styles.answerWindow}>
          <div className={styles.answerBar}>
            <span>/ask / Acme rollout</span>
            <span>5 sources linked</span>
          </div>
          <div className={styles.question}>
            <span>You</span>
            <p>Give me the current status, handoff, blockers, and customer commitments.</p>
          </div>
          <div className={styles.answerBody}>
            <span>Timeline</span>
            <h3>SSO blocks launch. Friday’s customer update is still due.</h3>
            <p>
              The customer expects an update by Friday{' '}
              <Citation id="01" label="Telegram group message" />. Onboarding copy was approved{' '}
              <Citation id="02" label="Slack approval" /> and the migration callback merged{' '}
              <Citation id="04" label="GitHub pull request" />. SSO remains the launch blocker{' '}
              <Citation id="03" label="launch review meeting" />. Priya Shah owns the migration
              checklist and its Friday review{' '}
              <Citation id="05" label="Timeline Document Drive checklist" />.
            </p>
          </div>
          <div className={styles.answerFooter}>
            <span>Draft answer / cited</span>
            <span>Visibility checked</span>
            <span>Every claim inspectable</span>
          </div>
        </article>

        <aside className={styles.receiptLedger} aria-labelledby="receipt-ledger-title">
          <div className={styles.ledgerTitle}>
            <span id="receipt-ledger-title">Evidence behind this answer</span>
            <span>5 / 5</span>
          </div>
          <ol>
            {ACME_EVENTS.map((event) => (
              <li key={event.id}>
                <a href={`#acme-source-${event.id}`}>
                  <span>[{event.id}]</span>
                  <strong>{event.title}</strong>
                  <small>
                    {event.shortSource} / {event.day} {event.time}
                  </small>
                </a>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </section>
  );
}

function TrustScene() {
  return (
    <section
      id="trust"
      className={styles.scene}
      aria-labelledby="trust-title"
      data-scene="04-trust"
    >
      <SceneHeading
        number="04"
        label="For teams"
        id="trust-title"
        title={
          <>
            When the work is scattered, the answer <em>should not be.</em>
          </>
        }
        copy="Timeline gives client delivery, account, product, and engineering teams one current account of what happened without asking everyone to maintain another system."
      />
      <div className={styles.fitPanel} data-home-diagram>
        <div className={styles.fitPanelIntro}>
          <span className={styles.monoLabel}>Three everyday jobs</span>
          <h3>Teams that owe someone a reliable answer.</h3>
          <p>
            When status is scattered, Timeline turns the work already happening into a brief you can
            stand behind.
          </p>
        </div>
        <div className={styles.audienceRail} aria-label="Teams Timeline serves">
          {AUDIENCES.map((audience) => (
            <Link href={audience.href} key={audience.name}>
              <span>{audience.index}</span>
              <h4>{audience.name}</h4>
              <p>{audience.outcome}</p>
              <small>
                {audience.result}
                <span aria-hidden="true"> ↗</span>
              </small>
            </Link>
          ))}
        </div>
      </div>

      <div className={styles.trustFlowPanel} data-home-diagram aria-labelledby="trust-flow-title">
        <header>
          <span className={styles.monoLabel}>How one answer stays trustworthy</span>
          <h3 id="trust-flow-title">Every answer carries its evidence chain.</h3>
          <p>
            Timeline preserves source content, checks access at retrieval, and keeps citations
            attached to the answer. If evidence suggests a lasting workspace change, Timeline
            proposes it for human review instead of applying it on its own.
          </p>
        </header>
        <ol className={styles.trustFlow}>
          {TRUST_STEPS.map((step) => (
            <li key={step.index}>
              <span>{step.index}</span>
              <strong>{step.title}</strong>
              <small>{step.detail}</small>
            </li>
          ))}
        </ol>
        <div className={styles.trustFlowProof} aria-label="Timeline evidence safeguards">
          <span>Immutable raw evidence</span>
          <span>Team isolation</span>
          <span>Per-event privacy</span>
          <span>Inspectable citations</span>
          <span>Approval-backed suggestions</span>
        </div>
      </div>
    </section>
  );
}

function CtaScene({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <section
      className={cn(styles.scene, styles.ctaScene)}
      aria-labelledby="cta-title"
      data-scene="05-cta"
    >
      <div className={styles.ctaInner} data-home-reveal>
        <SceneIndex number="05" label="One-project start" />
        <h2 id="cta-title">
          Give it one real project. <em>Ask one honest question.</em>
        </h2>
        <p>
          Choose one project and the smallest useful source set. Preserve a week of selected work,
          then ask for current status, the next handoff, open blockers, and customer commitments.
        </p>
        <Link href={isSignedIn ? '/app' : '/sign-up'} className={styles.primaryCta}>
          {isSignedIn ? 'Open your Timeline' : 'Try one real project'} <span aria-hidden>→</span>
        </Link>
        {isSignedIn ? null : (
          <>
            <p className={styles.ctaFinePrint}>
              Free to start · no card required ·{' '}
              <Link href="/pricing" className={styles.textLink}>
                See pricing
              </Link>
            </p>
            <span className={styles.ctaSignIn}>
              Already have a Timeline? <Link href="/sign-in">Sign in</Link>
            </span>
          </>
        )}
        <div className={styles.ctaProof} aria-label="Timeline trust defaults">
          <span>Captured</span>
          <span>Chronological</span>
          <span>Cited</span>
          <span>Team-scoped</span>
        </div>
      </div>
    </section>
  );
}

function SceneIndex({ number, label }: { number: string; label: string }) {
  return (
    <div className={styles.sceneIndex}>
      <span>{number} / 05</span>
      <span>{label}</span>
    </div>
  );
}

function SceneHeading({
  number,
  label,
  id,
  title,
  copy,
}: {
  number: string;
  label: string;
  id: string;
  title: ReactNode;
  copy: string;
}) {
  return (
    <header className={styles.sceneHeading} data-home-reveal>
      <SceneIndex number={number} label={label} />
      <div>
        <h2 id={id}>{title}</h2>
        <p>{copy}</p>
      </div>
    </header>
  );
}

function Citation({ id, label }: { id: string; label: string }) {
  return (
    <a href={`#acme-source-${id}`} className={styles.citation}>
      <span aria-hidden="true">[{id}]</span>
      <span className="sr-only">
        Source {id}: {label}
      </span>
    </a>
  );
}

function Footer({ isSignedIn }: { isSignedIn: boolean }) {
  const year = new Date().getFullYear();
  return (
    <footer className={styles.footer}>
      <div>
        <span className={styles.footerBrand}>
          <Logo ariaHidden /> The Timeline
        </span>
        <span>© {year}</span>
      </div>
      <div className={styles.footerNavigation}>
        <nav aria-label="Explore The Timeline">
          <PublicNavigationItems
            currentSection="product"
            listClassName={styles.footerLinks}
            activeItemClassName={styles.footerLinkActive}
          />
        </nav>
        <nav aria-label="Support and legal">
          <GitHubSourceLink compact className={styles.footerGithub} />
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href={CONTACT_HREF}>Contact</Link>
          <Link href={isSignedIn ? '/app' : '/sign-in'}>
            {isSignedIn ? 'Dashboard' : 'Sign in'}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
