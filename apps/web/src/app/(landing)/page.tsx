import * as integrationsLib from '@timeline/shared/integrations/registry';
import Link from 'next/link';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { LandingSkipLink } from '@/app/(landing)/_landing-skip-link';
import styles from '@/app/(landing)/home.module.css';
import { Logo, Wordmark } from '@/components/brand/logo';
import { GitHubSourceLink } from '@/components/github-source-link';
import { HomeMotion } from '@/components/marketing/home/home-motion';
import { ThemeToggle } from '@/components/theme-toggle';
import { auth } from '@/lib/auth';
import { getLegalContactEmail } from '@/lib/legal-versions';
import { getSiteUrl } from '@/lib/site-url';
import { cn } from '@/lib/utils';

const SITE_NAME = 'The Timeline';
const SITE_TAGLINE = 'The work becomes the record';
const SITE_DESCRIPTION =
  'The Timeline turns work from Slack, meetings, code, and documents into a chronological project record and cited answers.';
const CONTACT_HREF = '/help/support';
const JSON_SCRIPT_ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
};

export const metadata: Metadata = {
  title: `${SITE_NAME} | ${SITE_TAGLINE}`,
  description: SITE_DESCRIPTION,
  keywords: [
    'operational memory',
    'project history',
    'cited AI answers',
    'Slack knowledge base',
    'meeting transcript search',
    'team timeline',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    title: `${SITE_NAME} | ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    type: 'website',
    siteName: SITE_NAME,
    url: '/',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'The Timeline, the work becomes the record',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} | ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: ['/twitter-image'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-snippet': -1, 'max-image-preview': 'large' },
  },
};

const NORTHLINE_EVENTS = [
  {
    id: '01',
    day: 'Monday',
    dateTime: '2026-08-03T09:14:00+03:00',
    time: '09:14',
    source: 'Slack / #northline',
    shortSource: 'Slack',
    title: 'Onboarding copy approved',
    detail: 'Design approved the onboarding copy. Implementation can continue.',
  },
  {
    id: '02',
    day: 'Tuesday',
    dateTime: '2026-08-04T11:40:00+03:00',
    time: '11:40',
    source: 'Meeting / launch review',
    shortSource: 'Meeting',
    title: 'SSO named as the blocker',
    detail: 'The launch review confirmed SSO is the only remaining launch blocker.',
  },
  {
    id: '03',
    day: 'Wednesday',
    dateTime: '2026-08-05T15:22:00+03:00',
    time: '15:22',
    source: 'GitHub / PR #482',
    shortSource: 'GitHub',
    title: 'Migration callback merged',
    detail: 'The migration callback merged and passed CI.',
  },
  {
    id: '04',
    day: 'Thursday',
    dateTime: '2026-08-06T17:08:00+03:00',
    time: '17:08',
    source: 'Google Drive / migration checklist',
    shortSource: 'Drive',
    title: 'Owner and review date recorded',
    detail: 'Priya owns the migration checklist. The next review is due Friday.',
  },
] as const;

const HERO_SIGNALS = [
  ...NORTHLINE_EVENTS.map(({ time, shortSource }) => ({ time, source: shortSource })),
  { time: '13:05', source: 'Linear' },
  { time: '18:21', source: 'Sentry' },
] as const;

const AUDIENCES = [
  {
    index: '01',
    name: 'Client delivery',
    outcome: 'A client-ready update with every claim attached to its source.',
  },
  {
    index: '02',
    name: 'Implementation',
    outcome: 'One current handoff instead of three systems and a meeting replay.',
  },
  {
    index: '03',
    name: 'Product and operations',
    outcome: 'A chronology that connects decisions to delivery.',
  },
] as const;

export default async function LandingPage() {
  const session = await auth();
  const isSignedIn = Boolean(session?.user);
  const nativeConnectors: string[] = [];
  const availableNativeConnectors: string[] = [];
  const unconfiguredNativeConnectors: string[] = [];
  for (const connector of integrationsLib.listCatalog()) {
    if (connector.kind !== 'native' || connector.ingestStatus !== 'implemented') continue;
    nativeConnectors.push(connector.label);
    if (connector.status === 'native_available') availableNativeConnectors.push(connector.label);
    if (connector.status === 'native_unconfigured') {
      unconfiguredNativeConnectors.push(connector.label);
    }
  }

  return (
    <div className={styles.page} data-home-root>
      <StructuredData nativeConnectors={nativeConnectors} />
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
        <ChronologyScene />
        <AnswerScene />
        <TrustScene
          availableNativeConnectors={availableNativeConnectors}
          unconfiguredNativeConnectors={unconfiguredNativeConnectors}
        />
        <CtaScene isSignedIn={isSignedIn} />
      </main>
      <Footer isSignedIn={isSignedIn} />
    </div>
  );
}

function StructuredData({ nativeConnectors }: { nativeConnectors: string[] }) {
  const legalContactEmail = getLegalContactEmail();
  const siteUrl = getSiteUrl();
  const orgId = new URL('/#organization', siteUrl).toString();
  const siteId = new URL('/#website', siteUrl).toString();
  const pageId = new URL('/#webpage', siteUrl).toString();
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
        description: SITE_DESCRIPTION,
        publisher: { '@id': orgId },
      },
      {
        '@type': 'WebPage',
        '@id': pageId,
        url: siteUrl,
        name: `${SITE_NAME} | ${SITE_TAGLINE}`,
        description: SITE_DESCRIPTION,
        isPartOf: { '@id': siteId },
        about: { '@id': appId },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': appId,
        name: SITE_NAME,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description: SITE_DESCRIPTION,
        url: siteUrl,
        publisher: { '@id': orgId },
        featureList: [
          'Chronological project history from captured work',
          'Cited answers linked to immutable source events',
          `Built-in native ingestion adapters for ${nativeConnectors.join(', ')}`,
          'Meeting transcript, document, message, and email capture',
          'Team-scoped storage with per-event visibility',
        ],
      },
    ],
  };

  return (
    // react-doctor-disable-next-line react-doctor/no-danger, react-doctor/dangerous-html-sink
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: stringifyJsonForHtmlScript(graph) }}
    />
  );
}

function stringifyJsonForHtmlScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&]/g, (character) => {
    return JSON_SCRIPT_ESCAPES[character] ?? character;
  });
}

function TopNav({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <header className={styles.masthead}>
      <Link href="/" aria-label="The Timeline home" className={styles.brandLink}>
        <Wordmark compact />
      </Link>
      <div className={styles.mastStatus} aria-hidden="true">
        <span /> Every answer cited
      </div>
      <nav className={styles.nav} aria-label="Public navigation">
        <GitHubSourceLink compact className={styles.githubLink} />
        <Link href="/help" className={styles.navLink}>
          Help
        </Link>
        {isSignedIn ? null : (
          <Link href="/sign-in" className={cn(styles.navLink, styles.signInLink)}>
            Sign in
          </Link>
        )}
        <ThemeToggle className={styles.themeToggle} />
        <Link href={isSignedIn ? '/app' : '/sign-up'} className={styles.navCta}>
          {isSignedIn ? 'Dashboard' : 'Try one project'}
        </Link>
      </nav>
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
          Your team already leaves the truth behind in messages, meetings, code, and documents.
          Timeline turns those fragments into chronology, then answers with receipts.
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
        data-home-reveal
        aria-label="Six connected Northline work signals converge into cited project memory"
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
              index > 3 && styles.orbitSourceAux,
            )}
          >
            <span>{signal.time}</span>
            <strong>{signal.source}</strong>
          </div>
        ))}
        <p className={styles.observatoryCaption}>
          Northline / 6 connected channels / 4 cited events
        </p>
      </div>
    </section>
  );
}

function ChronologyScene() {
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
        copy="Each fragment keeps its source, author, time, and visibility while Slack context, meetings, code, and documents settle into one inspectable Northline history."
      />
      <div className={styles.timelineStage} data-home-reveal>
        <div className={styles.timelineHeader}>
          <span>Northline / Last 7 days</span>
          <span>4 evidence items</span>
        </div>
        <ol className={styles.timelineList}>
          {NORTHLINE_EVENTS.map((event) => (
            <li key={event.id} id={`northline-source-${event.id}`}>
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
    </section>
  );
}

function AnswerScene() {
  return (
    <section className={styles.scene} aria-labelledby="answer-title" data-scene="03-answer">
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
      <div className={styles.answerLayout} data-home-reveal>
        <article className={styles.answerWindow}>
          <div className={styles.answerBar}>
            <span>/ask / Northline</span>
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
              owns the migration checklist, due for review Friday{' '}
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
            {NORTHLINE_EVENTS.map((event) => (
              <li key={event.id}>
                <a href={`#northline-source-${event.id}`}>
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

function TrustScene({
  availableNativeConnectors,
  unconfiguredNativeConnectors,
}: {
  availableNativeConnectors: string[];
  unconfiguredNativeConnectors: string[];
}) {
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
        label="Fit + trust"
        id="trust-title"
        title={
          <>
            The answer can change. The source <em>does not.</em>
          </>
        }
        copy="Timeline is built so a faster model can re-read the work tomorrow without rewriting what your team actually said today."
      />
      <div className={styles.audienceStrip} data-home-reveal aria-label="Teams Timeline serves">
        {AUDIENCES.map((audience) => (
          <article key={audience.name}>
            <span>{audience.index}</span>
            <h3>{audience.name}</h3>
            <p>{audience.outcome}</p>
          </article>
        ))}
      </div>
      <div className={styles.trustLayout} data-home-reveal>
        <div className={styles.trustPrinciples}>
          <TrustRow index="01" title="Immutable raw evidence">
            Source-ingested events remain unchanged. Derived facts can be regenerated.
          </TrustRow>
          <TrustRow index="02" title="Team isolation">
            Every structured and vector query is team-scoped below the interface.
          </TrustRow>
          <TrustRow index="03" title="Per-event privacy">
            Private, team, and named-person visibility follows the evidence into retrieval.
          </TrustRow>
          <TrustRow index="04" title="Inspectable citations">
            Answers link back to the message, meeting, code change, or document they came from.
          </TrustRow>
        </div>

        <aside className={styles.connectorTeaser} aria-labelledby="connector-title">
          <span className={styles.monoLabel}>Connector truth / current</span>
          <h3 id="connector-title">Keep the tools. Connect the record.</h3>
          <p>
            Native ingestion, live MCP access, and planned support are different capabilities. We
            name the boundary instead of blurring it.
          </p>
          <div className={styles.nativeConnectors}>
            <span>Native ingestion / available on this deployment</span>
            {availableNativeConnectors.length > 0 ? (
              <ConnectorList connectors={availableNativeConnectors} />
            ) : (
              <p className={styles.connectorEmpty}>No native OAuth connectors are configured.</p>
            )}
          </div>
          {unconfiguredNativeConnectors.length > 0 ? (
            <div className={styles.nativeConnectors}>
              <span>Implemented / awaiting deployment configuration</span>
              <ConnectorList connectors={unconfiguredNativeConnectors} />
            </div>
          ) : null}
          <dl className={styles.connectorTiers}>
            <div>
              <dt>MCP access</dt>
              <dd>Compatible external tools can be reached live through connected MCP servers.</dd>
            </div>
            <div>
              <dt>Planned</dt>
              <dd>Planned connectors are labeled before launch and cannot be connected yet.</dd>
            </div>
          </dl>
          <Link href="/help" className={styles.textLink}>
            Read the current product guides
          </Link>
        </aside>
      </div>
    </section>
  );
}

function ConnectorList({ connectors }: { connectors: string[] }) {
  return (
    <ul>
      {connectors.map((connector) => (
        <li key={connector}>{connector}</li>
      ))}
    </ul>
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
    <a href={`#northline-source-${id}`} className={styles.citation}>
      <span aria-hidden="true">[{id}]</span>
      <span className="sr-only">
        Source {id}: {label}
      </span>
    </a>
  );
}

function TrustRow({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <article>
      <span>{index}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </article>
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
      <nav aria-label="Footer navigation">
        <GitHubSourceLink compact className={styles.footerGithub} />
        <Link href="/help">Help</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href={CONTACT_HREF}>Contact</Link>
        <Link href={isSignedIn ? '/app' : '/sign-in'}>{isSignedIn ? 'Dashboard' : 'Sign in'}</Link>
      </nav>
    </footer>
  );
}
