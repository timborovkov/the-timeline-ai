import { FileText, Globe, Mail, Video, Webhook } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { LandingSkipLink } from '@/app/(landing)/_landing-skip-link';
import styles from '@/app/(landing)/home.module.css';
import { Logo } from '@/components/brand/logo';
import { GitHubSourceLink } from '@/components/github-source-link';
import { AgentSetupCard } from '@/components/marketing/agents/agent-setup-card';
import {
  CTA_MICROCOPY_LEAD,
  SEE_IT_FIRST_HREF,
  SEE_IT_FIRST_LABEL,
  START_FREE_LABEL,
} from '@/components/marketing/copy';
import { FirstRunPath } from '@/components/marketing/first-run-path';
import { HomeMotion } from '@/components/marketing/home/home-motion';
import {
  HOME_ASK_SHOT,
  HOME_CLIENT_SHOT,
  HOME_DIGEST_SHOT,
  HOME_TIMELINE_SHOT,
  HOME_VOICE_SHOT,
  type HomeProofShot,
} from '@/components/marketing/home/proof';
import { TimelineFlowDiagram } from '@/components/marketing/home/timeline-flow-diagram';
import { CAPTURE_SURFACES } from '@/components/marketing/integrations/capture-surface-content';
import { CONNECTORS } from '@/components/marketing/integrations/connector-content';
import { MarketingProductScreenshot } from '@/components/marketing/product-screenshot';
import { PUBLIC_DEMO_STORY } from '@/components/marketing/public-demo-story';
import { TRUST_FLOW_CHIPS, TRUST_FLOW_STEPS } from '@/components/marketing/trust-flow-content';
import { USE_CASES } from '@/components/marketing/use-cases/content';
import { CookieSettingsButton } from '@/components/public-analytics';
import { PublicHeader } from '@/components/public-header';
import { PublicFooterColumns } from '@/components/public-navigation';
import { PublicSessionBranch } from '@/components/public-session-branch';
import {
  PUBLIC_DOCUMENT_REGISTRY,
  buildPublicStructuredData,
  metadataForPublicDocument,
  stringifyJsonLdForHtml,
} from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';
import { DEFAULT_SUPPORT_EMAIL } from '@/lib/support-links';
import { cn } from '@/lib/utils';

const SITE_NAME = 'The Timeline';
const CONTACT_HREF = '/help/support';
const HERO_INTRO =
  "Your team's work record: everything your team does, on one searchable timeline, kept current from Slack, Telegram, email and calls.";
const HOME_INTAKE_SURFACES = [
  ...CAPTURE_SURFACES.map((surface) => ({
    id: surface.id,
    name: surface.id === 'slack-chat' ? 'Slack' : surface.name,
    icon: surface.icon,
    logo:
      surface.icon === 'telegram' || surface.icon === 'slack'
        ? `/connectors/${surface.icon}.svg`
        : undefined,
    href: 'publicHref' in surface ? surface.publicHref : '/integrations#capture-surfaces',
  })),
  {
    id: 'documents',
    name: 'Documents',
    icon: 'file' as const,
    logo: undefined,
    href: '/help/documents',
  },
  ...CONNECTORS.filter((connector) => connector.slug !== 'slack').map((connector) => ({
    id: connector.slug,
    name: connector.name,
    icon: 'file' as const,
    logo: connector.logo,
    href: `/integrations/${connector.slug}`,
  })),
];
const HOME_DOCUMENT = getHomeDocument();

export const metadata: Metadata = {
  ...metadataForPublicDocument(HOME_DOCUMENT),
  keywords: [
    'work record',
    'auto-updating work record',
    'team daily log',
    'linked answers',
    'Slack and Telegram work record',
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

const AUDIENCES = USE_CASES.map((useCase, index) => ({
  index: String(index + 1).padStart(2, '0'),
  name: useCase.cardTitle,
  outcome:
    useCase.slug === 'work-record'
      ? 'Every decision, promise and handoff on one timeline, with where it was said.'
      : useCase.cardBody,
  result: useCase.navLabel,
  href: useCase.route,
}));

export default function LandingPage() {
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
      <PublicHeader currentSection="product" />
      <main id="main" tabIndex={-1}>
        <ClaimScene />
        <IntakeScene />
        <TimelineScene />
        <AnswerScene />
        <OrganisedScene />
        <AudienceScene />
        <CtaScene />
      </main>
      <Footer />
    </div>
  );
}

function StructuredData() {
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
    email: DEFAULT_SUPPORT_EMAIL,
  };

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

function ClaimScene() {
  return (
    <section
      className={cn(styles.scene, styles.claimScene)}
      aria-labelledby="claim-title"
      data-scene="01-claim"
    >
      <div className={styles.heroCopy}>
        <SceneIndex number="01" label="The auto-updating work record" />
        <h1 id="claim-title" className={styles.heroTitle}>
          Your team's work, <em>written down for you</em>
        </h1>
        <p className={styles.heroIntro}>{HERO_INTRO}</p>
        <div className={styles.heroActions}>
          <PublicSessionBranch
            signedOut={
              <Link
                href="/sign-up"
                data-public-analytics-cta="start_free"
                className={styles.primaryCta}
              >
                {START_FREE_LABEL} <span aria-hidden>→</span>
              </Link>
            }
            signedIn={
              <Link
                href="/app"
                data-public-analytics-cta="open_dashboard"
                className={styles.primaryCta}
              >
                Go to dashboard <span aria-hidden>→</span>
              </Link>
            }
          />
          <Link href={SEE_IT_FIRST_HREF} className={styles.textLink}>
            {SEE_IT_FIRST_LABEL}
          </Link>
        </div>
        <PublicSessionBranch
          signedOut={
            <div className={styles.heroMeta}>
              <p className={styles.ctaFinePrint}>
                {CTA_MICROCOPY_LEAD}{' '}
                <Link href="/pricing" className={styles.textLink}>
                  See pricing
                </Link>
              </p>
              <GitHubSourceLink appearance="inline" className={styles.heroGithubLink} />
            </div>
          }
          signedIn={
            <div className={styles.heroMeta}>
              <GitHubSourceLink appearance="inline" className={styles.heroGithubLink} />
            </div>
          }
        />
        <div className={styles.heroAgentSetup}>
          <AgentSetupCard />
        </div>
      </div>

      <TimelineFlowDiagram variant="hero" />
    </section>
  );
}

function IntakeScene() {
  return (
    <section
      id="sources"
      className={styles.scene}
      aria-labelledby="intake-title"
      data-scene="02-intake"
    >
      <SceneHeading
        number="02"
        label="What goes in"
        id="intake-title"
        title={
          <>
            Bring the work in. <em>Keep the context.</em>
          </>
        }
        copy="Connect the tools you use, forward email, upload documents, or scan a public website."
      />
      <ul className={styles.intakeRow} aria-label="Ways to send work to Timeline">
        {HOME_INTAKE_SURFACES.map((surface) => (
          <li key={surface.id}>
            <Link href={surface.href}>
              <HomeCaptureSurfaceIcon icon={surface.icon} logo={surface.logo} />
              <span>{surface.name}</span>
            </Link>
          </li>
        ))}
      </ul>
      <HomeProof shot={HOME_VOICE_SHOT} align="copy-first" />
    </section>
  );
}

function HomeCaptureSurfaceIcon({
  icon,
  logo,
}: {
  icon: (typeof HOME_INTAKE_SURFACES)[number]['icon'];
  logo?: string;
}) {
  if (logo) {
    return (
      <span className={cn(styles.captureSurfaceIcon, styles.captureSurfaceIconBrand)}>
        <Image src={logo} alt="" width={18} height={18} />
      </span>
    );
  }
  const Icon =
    icon === 'mail'
      ? Mail
      : icon === 'video'
        ? Video
        : icon === 'globe'
          ? Globe
          : icon === 'file'
            ? FileText
            : Webhook;
  return (
    <span className={styles.captureSurfaceIcon}>
      <Icon aria-hidden="true" size={16} strokeWidth={1.6} />
    </span>
  );
}

function TimelineScene() {
  return (
    <section className={styles.scene} aria-labelledby="timeline-title" data-scene="03-timeline">
      <SceneHeading
        number="03"
        label="One timeline"
        id="timeline-title"
        title={
          <>
            Everything lands on <em>one timeline.</em>
          </>
        }
        copy="Jira and Pipedrive can miss what was said in conversation. Bring those decisions and promises into the same chronology."
      />
      <div className={styles.timelineStage} data-home-diagram>
        <div className={styles.timelineHeader}>
          <span>Acme rollout / Last 7 days</span>
          <span>5 items</span>
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
      </div>
      <HomeProof shot={HOME_TIMELINE_SHOT} align="shot-first" />
    </section>
  );
}

function AnswerScene() {
  return (
    <section
      id="answer"
      className={styles.scene}
      aria-labelledby="answer-title"
      data-scene="04-ask"
    >
      <SceneHeading
        number="04"
        label="Ask it"
        id="answer-title"
        title={
          <>
            Status should not require an <em>investigation.</em>
          </>
        }
        copy="Get a status or handoff brief without retracing every conversation."
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
            <span>Draft answer / linked</span>
            <span>Visibility checked</span>
            <span>Every claim inspectable</span>
          </div>
        </article>

        <aside className={styles.receiptLedger} aria-labelledby="receipt-ledger-title">
          <header className={styles.ledgerTitle}>
            <span id="receipt-ledger-title">The original messages, with links</span>
            <span>5 / 5</span>
          </header>
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
                <details className={styles.ledgerInspect}>
                  <summary>Inspect example source</summary>
                  <div className={styles.ledgerInspectBody}>
                    <p>{event.detail}</p>
                  </div>
                </details>
              </li>
            ))}
          </ol>
        </aside>
      </div>
      <HomeProof shot={HOME_ASK_SHOT} align="copy-first" />
      <div className={styles.threadBlock} id="chat-to-answer">
        <h2 className={styles.threadHeading}>
          Ask in Slack. An agent can ask <em>the same record.</em>
        </h2>
        <p className={styles.threadLead}>
          Someone asks @Timeline in Slack. The bot answers with numbered citations back to the call
          and the email. Claude can retrieve the same Northstar evidence over MCP.
        </p>
        <div className={styles.threadLayout} data-home-diagram data-chat-to-answer>
          <article className={styles.slackThread} aria-label="Slack example">
            <header className={styles.slackBar}>
              <span>#northstar-pilot</span>
              <span>Slack</span>
            </header>
            <div className={styles.slackMessage}>
              <span className={styles.slackAvatar} aria-hidden="true">
                M
              </span>
              <div>
                <p className={styles.slackMeta}>
                  <strong>Casey Novak</strong>
                  <time dateTime="2026-07-08T16:12:00.000Z">16:12</time>
                </p>
                <p>
                  <span className={styles.slackMention}>@Timeline</span> what did we promise
                  Northstar on Tuesday's call?
                </p>
              </div>
            </div>
            <div className={styles.slackMessage}>
              <span className={styles.slackBotAvatar} aria-hidden="true">
                T
              </span>
              <div>
                <p className={styles.slackMeta}>
                  <strong>Timeline</strong>
                  <span>APP</span>
                  <time dateTime="2026-07-08T16:12:08.000Z">16:12</time>
                </p>
                <p>
                  Northstar Works committed to send the final sample export by July 8
                  <ThreadCitation n={1} label="Email from Elena Park" />. On the Northstar pilot
                  handoff review, Avery handed export validation to Mika and the team decided to use
                  the CSV fallback
                  <ThreadCitation n={2} label="Call transcript" />.
                </p>
                <ol className={styles.threadSources}>
                  <li id="thread-source-1">
                    <span>[1]</span>
                    <strong>Email from Elena Park</strong>
                    <small>Northstar pilot export commitment</small>
                  </li>
                  <li id="thread-source-2">
                    <span>[2]</span>
                    <strong>Call transcript</strong>
                    <small>Northstar pilot handoff review</small>
                  </li>
                </ol>
              </div>
            </div>
          </article>

          <article className={styles.mcpThread} aria-label="Claude MCP example">
            <header className={styles.mcpBar}>
              <span>Claude</span>
              <span>MCP</span>
            </header>
            <p className={styles.mcpPrompt}>What did we promise Northstar?</p>
            <ol className={styles.mcpCalls}>
              <li>
                <code>timeline.subject</code>
                <span>subject: Northstar</span>
              </li>
              <li>
                <code>timeline.get</code>
                <span>name: Northstar pilot handoff review</span>
              </li>
            </ol>
            <p className={styles.mcpAnswer}>
              Northstar Works committed to send the final sample export by July 8
              <ThreadCitation n={1} label="Email from Elena Park" />. Avery handed export validation
              to Mika, and the team decided to use the CSV fallback
              <ThreadCitation n={2} label="Call transcript" />.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}

function ThreadCitation({ n, label }: { n: number; label: string }) {
  return (
    <a href={`#thread-source-${n}`} className={styles.superCitation}>
      <sup aria-hidden="true">[{n}]</sup>
      <span className="sr-only">
        Source {n}: {label}
      </span>
    </a>
  );
}

function OrganisedScene() {
  return (
    <section className={styles.scene} aria-labelledby="organised-title" data-scene="05-organised">
      <SceneHeading
        number="05"
        label="Clients and to-dos"
        id="organised-title"
        title={
          <>
            Clients and to-dos, <em>ready for your review.</em>
          </>
        }
        copy="Replace manual CRM and task-board entry with suggested updates from your conversations."
      />
      <HomeProof shot={HOME_CLIENT_SHOT} align="shot-first">
        <p className={styles.approvalLine}>
          <strong>Suggested changes wait.</strong> A person approves each one.
        </p>
      </HomeProof>
    </section>
  );
}

function AudienceScene() {
  return (
    <section
      id="trust"
      className={styles.scene}
      aria-labelledby="trust-title"
      data-scene="06-audience"
    >
      <SceneHeading
        number="06"
        label="For teams"
        id="trust-title"
        title={
          <>
            Built for teams that run their work <em>through chat.</em>
          </>
        }
        copy="For client delivery, product and operations work that happens in conversation."
      />
      <HomeProof shot={HOME_DIGEST_SHOT} align="copy-first" />
      <div className={styles.fitPanel} data-home-diagram>
        <div className={styles.fitPanelIntro}>
          <span className={styles.monoLabel}>Six ways teams use it</span>
          <h3>One record, kept current from your conversations.</h3>
          <p>Choose the job you need below.</p>
        </div>
        <div className={styles.audienceRail} aria-label="Ways teams use The Timeline">
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
            Access is checked when a source is retrieved. The answer only uses evidence you can see.
          </p>
        </header>
        <ol className={styles.trustFlow}>
          {TRUST_FLOW_STEPS.map((step) => (
            <li key={step.index}>
              <span>{step.index}</span>
              <strong>{step.title}</strong>
              <small>{step.detail}</small>
            </li>
          ))}
        </ol>
        <div className={styles.trustFlowProof} aria-label="Timeline evidence safeguards">
          {TRUST_FLOW_CHIPS.map((chip) => (
            <span key={chip}>{chip}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaScene() {
  return (
    <section
      className={cn(styles.scene, styles.ctaScene)}
      aria-labelledby="cta-title"
      data-scene="07-start"
    >
      <div className={styles.ctaInner}>
        <SceneIndex number="07" label="Start free" />
        <h2 id="cta-title">
          Link one channel. <em>Watch the record fill in.</em>
        </h2>
        <p>
          Bring in your first source, then read the daily update or approve the suggested updates.
        </p>
        <FirstRunPath showNote={false} />
        <PublicSessionBranch
          signedOut={
            <Link
              href="/sign-up"
              data-public-analytics-cta="start_free"
              className={styles.primaryCta}
            >
              {START_FREE_LABEL} <span aria-hidden>→</span>
            </Link>
          }
          signedIn={
            <Link
              href="/app"
              data-public-analytics-cta="open_dashboard"
              className={styles.primaryCta}
            >
              Open your Timeline <span aria-hidden>→</span>
            </Link>
          }
        />
        <PublicSessionBranch
          signedOut={
            <>
              <p className={styles.ctaFinePrint}>
                {CTA_MICROCOPY_LEAD}{' '}
                <Link href="/pricing" className={styles.textLink}>
                  See pricing
                </Link>
              </p>
              <span className={styles.ctaSignIn}>
                Already have a Timeline? <Link href="/sign-in">Sign in</Link>
              </span>
            </>
          }
          signedIn={null}
        />
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
      <span>{number} / 07</span>
      <span>{label}</span>
    </div>
  );
}

function HomeProof({
  shot,
  align,
  children,
}: {
  shot: HomeProofShot;
  align: 'copy-first' | 'shot-first';
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(styles.proofStage, align === 'shot-first' && styles.proofShotFirst)}
      data-home-proof={shot.file}
    >
      <div className={styles.proofCopy}>
        <span className={styles.monoLabel}>{shot.kicker}</span>
        <h3 className={styles.proofCaption}>{shot.caption}</h3>
        <p className={styles.proofBody}>{shot.body}</p>
        {children}
      </div>
      <div className={styles.proofMedia}>
        <MarketingProductScreenshot
          file={shot.file}
          alt={shot.alt}
          caption={shot.caption}
          chrome="media"
        />
      </div>
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
    <header className={styles.sceneHeading}>
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

function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className={styles.footer}>
      <div className={styles.footerBrandRow}>
        <span className={styles.footerBrand}>
          <Logo ariaHidden /> The Timeline
        </span>
        <span>© {year}</span>
      </div>
      <nav aria-label="Explore The Timeline">
        <PublicFooterColumns
          currentSection="product"
          className={styles.footerColumns}
          headingClassName={styles.footerColumnTitle}
          activeItemClassName={styles.footerLinkActive}
          legalItems={
            <>
              <li>
                <GitHubSourceLink compact className={styles.footerGithub} />
              </li>
              <li>
                <Link href="/trust">Trust</Link>
              </li>
              <li>
                <Link href="/terms">Terms</Link>
              </li>
              <li>
                <Link href="/privacy">Privacy</Link>
              </li>
              <li>
                <Link href="/cookies">Cookies</Link>
              </li>
              <li>
                <CookieSettingsButton />
              </li>
              <li>
                <Link href={CONTACT_HREF} data-public-analytics-cta="contact_support">
                  Contact
                </Link>
              </li>
              <li>
                <PublicSessionBranch
                  signedOut={
                    <Link href="/sign-in" data-public-analytics-cta="sign_in">
                      Sign in
                    </Link>
                  }
                  signedIn={
                    <Link href="/app" data-public-analytics-cta="open_dashboard">
                      Dashboard
                    </Link>
                  }
                />
              </li>
            </>
          }
        />
      </nav>
    </footer>
  );
}
