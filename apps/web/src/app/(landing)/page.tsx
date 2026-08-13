import * as integrationsLib from '@timeline/shared/integrations/registry';
import Link from 'next/link';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { LandingSkipLink } from '@/app/(landing)/_landing-skip-link';
import styles from '@/app/(landing)/home.module.css';
import { Logo, Wordmark } from '@/components/brand/logo';
import { GitHubSourceLink } from '@/components/github-source-link';
import { HomeMotion } from '@/components/marketing/home/home-motion';
import { findConnectorByName } from '@/components/marketing/integrations/connector-content';
import {
  PUBLIC_DEMO_DISCLOSURE,
  PUBLIC_DEMO_STORY,
} from '@/components/marketing/public-demo-story';
import { PublicNavigationDisclosure, PublicNavigationItems } from '@/components/public-navigation';
import { ThemeToggle } from '@/components/theme-toggle';
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
    'operational memory',
    'project history',
    'cited AI answers',
    'Slack knowledge base',
    'meeting transcript search',
    'team timeline',
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

const HERO_SIGNALS = [
  ...ACME_EVENTS.map(({ time, shortSource }) => ({ time, source: shortSource, cited: true })),
  ...PUBLIC_DEMO_STORY.landing.connectedSignals.map((signal) => ({ ...signal, cited: false })),
] as const;

const AUDIENCES = [
  {
    index: '01',
    name: 'Client delivery',
    outcome: 'Send a client-ready update with every claim attached to its source.',
    result: 'Verifiable status',
  },
  {
    index: '02',
    name: 'Implementation',
    outcome: 'Recover the handoff without replaying every meeting or chasing every owner.',
    result: 'Current handoff',
  },
  {
    index: '03',
    name: 'Product and operations',
    outcome: 'Connect decisions, blockers, owners, and delivery in one inspectable history.',
    result: 'Decision trail',
  },
] as const;

const TRUST_STEPS = [
  {
    index: '01',
    title: 'Evidence arrives',
    detail: 'Slack / #acme-rollout',
  },
  {
    index: '02',
    title: 'Original stays intact',
    detail: 'Raw event / immutable',
  },
  {
    index: '03',
    title: 'Access is checked',
    detail: 'Team + event visibility',
  },
  {
    index: '04',
    title: 'Answer cites the source',
    detail: '[01] / inspectable',
  },
] as const;

interface NativeConnector {
  label: string;
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
    if (connector.status === 'native_available') {
      nativeConnectors.push({ label: connector.label, state: 'available', href });
    }
    if (connector.status === 'native_unconfigured') {
      nativeConnectors.push({ label: connector.label, state: 'setup-required', href });
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
      <TopNav isSignedIn={isSignedIn} />
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

function TopNav({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <header className={styles.masthead}>
      <Link href="/" aria-label="The Timeline home" className={styles.brandLink}>
        <Wordmark compact />
      </Link>
      <nav aria-label="Public navigation">
        <PublicNavigationItems
          currentSection="product"
          listClassName={styles.mastLinks}
          itemClassName={styles.navLink}
          activeItemClassName={styles.navLinkActive}
        />
      </nav>
      <div className={styles.nav}>
        <PublicNavigationDisclosure currentSection="product" className={styles.publicMenu} />
        <GitHubSourceLink compact className={styles.githubLink} />
        {isSignedIn ? null : (
          <Link href="/sign-in" className={cn(styles.navLink, styles.signInLink)}>
            Sign in
          </Link>
        )}
        <ThemeToggle className={styles.themeToggle} />
        <Link href={isSignedIn ? '/app' : '/sign-up'} className={styles.navCta}>
          {isSignedIn ? 'Dashboard' : 'Try one project'}
        </Link>
      </div>
    </header>
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
        <SceneIndex number="01" label="Claim" />
        <h1 id="claim-title" className={styles.heroTitle}>
          The work <em>becomes</em> the record.
        </h1>
        <p className={styles.heroIntro}>
          Timeline watches the tools where a project happens—messages, meetings, code, and
          documents—then builds one chronological history you can question. Every answer links back
          to the work.
        </p>
        <div className={styles.heroActions}>
          <Link href={isSignedIn ? '/app' : '/sign-up'} className={styles.primaryCta}>
            {isSignedIn ? 'Go to dashboard' : 'Try one real project'} <span aria-hidden>→</span>
          </Link>
          <a href="#sources" className={styles.textLink}>
            Watch the evidence resolve
          </a>
        </div>
        <div className={styles.heroSourceLink}>
          <GitHubSourceLink />
        </div>
      </div>

      <AmbientTrace />
      <div
        className={styles.observatory}
        data-home-diagram
        aria-label="Four cited Acme rollout work signals converge into project memory while two other connected signals remain unused in this answer"
      >
        <svg className={styles.orbitLines} viewBox="0 0 600 600" aria-hidden="true">
          <path d="M118 116 C 205 150, 226 242, 300 300" />
          <path d="M486 142 C 414 174, 390 244, 300 300" />
          <path d="M112 462 C 188 412, 226 354, 300 300" />
          <path d="M490 470 C 420 420, 388 354, 300 300" />
          <path d="M70 300 C 170 300, 220 300, 300 300" />
          <path d="M530 310 C 430 310, 380 304, 300 300" />
        </svg>
        <div className={styles.orbitOuter} aria-hidden="true" />
        <div className={styles.orbitInner} aria-hidden="true" />
        <div className={styles.memoryCore}>
          <Logo ariaHidden />
          <span>Cited project memory</span>
        </div>
        {HERO_SIGNALS.map((signal, index) => (
          <div
            key={signal.source}
            className={cn(
              styles.orbitSource,
              styles[`orbitSource${index + 1}`],
              !signal.cited && styles.orbitSourceAux,
            )}
          >
            <span>{signal.time}</span>
            <strong>{signal.source}</strong>
            {signal.cited ? null : <small>Connected, not cited</small>}
          </div>
        ))}
        <p className={styles.observatoryCaption}>
          {PUBLIC_DEMO_DISCLOSURE} / Acme rollout / 4 cited + 2 connected
        </p>
      </div>
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
            Work enters once. Time gives it <em>shape.</em>
          </>
        }
        copy="Each fragment keeps its source, author, time, and visibility while Slack context, meetings, code, and documents settle into one inspectable Acme rollout history."
      />
      <div className={styles.timelineStage} data-home-diagram>
        <div className={styles.timelineHeader}>
          <span>Acme rollout / Last 7 days</span>
          <span>4 evidence items</span>
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
          <span className={styles.monoLabel}>Capture contract</span>
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
        <h3 id="connector-title">Keep the tools. Connect the record.</h3>
        <p>
          Native ingestion creates durable Timeline evidence. MCP provides live approved tool
          access. Planned support remains clearly labeled and unavailable until it is real.
        </p>
      </header>
      <div className={styles.connectorContent}>
        <div className={styles.nativeConnectors}>
          <span>Native ingestion</span>
          {nativeConnectors.length > 0 ? (
            <ul>
              {nativeConnectors.map((connector) => (
                <li key={connector.label}>
                  {connector.href ? (
                    <Link href={connector.href}>{connector.label}</Link>
                  ) : (
                    <strong>{connector.label}</strong>
                  )}
                  <small>
                    {connector.state === 'available' ? 'Available here' : 'Setup required'}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.connectorEmpty}>No native OAuth connectors are configured.</p>
          )}
        </div>
        <dl className={styles.connectorTiers}>
          <div>
            <dt>MCP access</dt>
            <dd>Live approved tool access, not passive ingestion.</dd>
          </div>
          <div>
            <dt>Planned</dt>
            <dd>Not connectable until native support is available.</dd>
          </div>
        </dl>
        <Link href="/integrations" className={styles.textLink}>
          Explore all integrations
        </Link>
      </div>
    </aside>
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
      <AmbientTrace />
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
            <span>4 sources linked</span>
          </div>
          <div className={styles.question}>
            <span>You</span>
            <p>What changed, what is blocked, and what do we owe them?</p>
          </div>
          <div className={styles.answerBody}>
            <span>Timeline</span>
            <h3>Launch is waiting on SSO. Everything else moved.</h3>
            <p>
              Onboarding copy was approved <Citation id="01" label="Slack approval" /> and the
              migration callback merged <Citation id="03" label="GitHub pull request" />. SSO is
              still the launch blocker <Citation id="02" label="launch review meeting" />. Priya
              Shah owns the migration checklist, due for review Friday{' '}
              <Citation id="04" label="Google Drive checklist" />.
            </p>
          </div>
          <div className={styles.answerFooter}>
            <span>Answer / cited</span>
            <span>Visibility checked</span>
            <span>Sources immutable</span>
          </div>
        </article>

        <aside className={styles.receiptLedger} aria-labelledby="receipt-ledger-title">
          <div className={styles.ledgerTitle}>
            <span id="receipt-ledger-title">Evidence behind this answer</span>
            <span>4 / 4</span>
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
      <AmbientTrace />
      <SceneHeading
        number="04"
        label="For teams"
        id="trust-title"
        title={
          <>
            When the work is scattered, the answer <em>should not be.</em>
          </>
        }
        copy="Timeline gives client delivery, implementation, product, and operations teams one current account of what happened—without asking everyone to maintain another system."
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
            <article key={audience.name}>
              <span>{audience.index}</span>
              <h4>{audience.name}</h4>
              <p>{audience.outcome}</p>
              <small>{audience.result}</small>
            </article>
          ))}
        </div>
      </div>

      <div className={styles.trustFlowPanel} data-home-diagram aria-labelledby="trust-flow-title">
        <header>
          <span className={styles.monoLabel}>How one answer stays trustworthy</span>
          <h3 id="trust-flow-title">Every answer carries its evidence chain.</h3>
          <p>
            Timeline preserves source content, checks access at retrieval, and keeps the citation
            attached to the final answer.
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
          Connect the conversations and work where a project already lives. Let Timeline capture a
          week, then ask what changed, what is blocked, and what you owe next.
        </p>
        <Link href={isSignedIn ? '/app' : '/sign-up'} className={styles.primaryCta}>
          {isSignedIn ? 'Open your Timeline' : 'Try one real project'} <span aria-hidden>→</span>
        </Link>
        {isSignedIn ? null : (
          <span className={styles.ctaSignIn}>
            Already have a Timeline? <Link href="/sign-in">Sign in</Link>
          </span>
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

function AmbientTrace() {
  return (
    <div className={styles.ambientTrace} data-home-ambient aria-hidden="true">
      <span />
      <span />
      <span />
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
