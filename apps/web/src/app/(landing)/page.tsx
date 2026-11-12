import {
  Building2,
  CheckSquare,
  FileText,
  Folder,
  Globe,
  Handshake,
  Mail,
  UserRound,
  Video,
  Webhook,
} from 'lucide-react';
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
import { CitedAnswer } from '@/components/marketing/home/cited-answer';
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
        <UseCaseOverview />
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
          Your team's work, <em>written</em> down for you
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

function UseCaseOverview() {
  return (
    <section
      className={styles.scene}
      aria-labelledby="use-case-overview-title"
      data-use-case-overview
    >
      <div className={styles.fitPanel} data-home-diagram>
        <div className={styles.fitPanelIntro}>
          <span className={styles.monoLabel}>Six ways teams use it</span>
          <h2 id="use-case-overview-title">One record, kept current from your conversations.</h2>
          <p>Choose the job you need below.</p>
        </div>
        <div className={styles.audienceRail} aria-label="Ways teams use The Timeline">
          {AUDIENCES.map((audience) => (
            <Link href={audience.href} key={audience.name}>
              <span>{audience.index}</span>
              <h3>{audience.name}</h3>
              <p>{audience.outcome}</p>
              <small>
                {audience.result}
                <span aria-hidden="true"> ↗</span>
              </small>
            </Link>
          ))}
        </div>
      </div>
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
            Bring the work in. Keep the <em>context.</em>
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
            Everything lands on one <em>timeline.</em>
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
      <CitedAnswer />
      <HomeProof shot={HOME_ASK_SHOT} align="copy-first" />
      <div className={styles.threadBlock} id="chat-to-answer">
        <h2 className={styles.threadHeading}>
          Your chat. Your agent. One <em>record.</em>
        </h2>
        <p className={styles.threadLead}>
          Ask in a connected chat or through your agent. Both can find the answer and the sources
          behind it.
        </p>
        <div className={styles.threadLayout} data-chat-to-answer>
          {(['Chat', 'Agent'] as const).map((surface) => (
            <article
              key={surface}
              className={styles.slackThread}
              aria-label={`${surface} conversation`}
            >
              <header className={styles.slackBar}>
                <strong>{surface}</strong>
                <span>{surface === 'Chat' ? 'With your team' : 'With your assistant'}</span>
              </header>
              <div className={styles.slackMessage}>
                <span className={styles.slackAvatar} aria-hidden="true">
                  Y
                </span>
                <div>
                  <p className={styles.slackMeta}>
                    <strong>You</strong>
                  </p>
                  <p>What did we promise Northstar?</p>
                </div>
              </div>
              <div className={styles.slackMessage}>
                <span className={styles.slackBotAvatar} aria-hidden="true">
                  {surface === 'Chat' ? 'T' : 'A'}
                </span>
                <div>
                  <p className={styles.slackMeta}>
                    <strong>{surface === 'Chat' ? 'The Timeline' : 'Your agent'}</strong>
                  </p>
                  <p>
                    The final sample export is due July 8
                    <ThreadCitation n={1} label="Email from Elena Park" />. Mika owns export
                    validation, using the CSV fallback
                    <ThreadCitation n={2} label="Call transcript" />.
                  </p>
                  <ol className={styles.threadSources} aria-label="Answer sources">
                    <li>
                      <span>[1]</span>
                      <strong>Email from Elena Park</strong>
                      <small>Export commitment</small>
                    </li>
                    <li>
                      <span>[2]</span>
                      <strong>Call transcript</strong>
                      <small>Handoff and next steps</small>
                    </li>
                  </ol>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function ThreadCitation({ n, label }: { n: number; label: string }) {
  return (
    <span className={styles.superCitation}>
      <sup aria-hidden="true">[{n}]</sup>
      <span className="sr-only">
        Source {n}: {label}
      </span>
    </span>
  );
}

function OrganisedScene() {
  return (
    <section className={styles.scene} aria-labelledby="organised-title" data-scene="05-organised">
      <SceneHeading
        number="05"
        label="Connected records"
        id="organised-title"
        title={
          <>
            Conversations become connected <em>records.</em>
          </>
        }
        copy="Tasks, people, projects, companies and deals—with their history, relationships and next steps in one place."
      />
      <div className={styles.recordShowcase} aria-label="Connected work records">
        <div className={styles.recordFlow}>
          <span>Conversations</span>
          <span aria-hidden="true">→</span>
          <span>Suggested changes</span>
          <span aria-hidden="true">→</span>
          <span>Your approval</span>
          <span aria-hidden="true">→</span>
          <strong>Connected records</strong>
        </div>
        <ul className={styles.recordGrid}>
          {[
            {
              type: 'Tasks',
              icon: CheckSquare,
              description: 'What needs doing, who owns it and when it’s due.',
              links: ['Owner → Person', 'Work → Project'],
            },
            {
              type: 'People',
              icon: UserRound,
              description: 'The people involved, with their conversations and commitments.',
              links: ['Works with → Company', 'Owns → Tasks'],
            },
            {
              type: 'Projects',
              icon: Folder,
              description: 'The work in progress, its decisions, blockers and next steps.',
              links: ['Includes → Tasks', 'Involves → People'],
            },
            {
              type: 'Companies',
              icon: Building2,
              description:
                'The relationship in one place, from first conversation to ongoing work.',
              links: ['Contacts → People', 'Work → Projects'],
            },
            {
              type: 'Deals',
              icon: Handshake,
              description: 'The opportunity, its stage and the next follow-up.',
              links: ['Customer → Company', 'Follow-up → Task'],
            },
          ].map(({ type, icon: Icon, description, links }) => (
            <li key={type} className={styles.recordCard}>
              <Icon size={24} aria-hidden="true" />
              <h3>{type}</h3>
              <p>{description}</p>
              <ul aria-label={`${type} relationships`}>
                {links.map((link) => (
                  <li key={link}>{link}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className={styles.recordNote}>
          Each record keeps the evidence behind it. Related work stays connected.
        </p>
      </div>
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
            Built for teams that run their work through <em>chat.</em>
          </>
        }
        copy="For client delivery, product and operations work that happens in conversation."
      />
      <HomeProof shot={HOME_DIGEST_SHOT} align="copy-first" />
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
        <div className={styles.ctaCopy}>
          <SceneIndex number="07" label="Start free" />
          <h2 id="cta-title">
            Link one channel. Watch the <em>record</em> fill in.
          </h2>
          <p>
            Bring in your first source, then read the daily update or approve the suggested updates.
          </p>
        </div>
        <div className={styles.ctaActions}>
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
        </div>
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
