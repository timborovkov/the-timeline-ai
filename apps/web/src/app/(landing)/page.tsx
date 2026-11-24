import {
  Building2,
  CheckSquare,
  FileText,
  Folder,
  Globe,
  Handshake,
  Mail,
  ShieldCheck,
  UserRound,
  Video,
  Webhook,
} from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LandingSkipLink } from '@/app/(landing)/_landing-skip-link';
import styles from '@/app/(landing)/home.module.css';
import { GitHubSourceLink } from '@/components/github-source-link';
import {
  CTA_MICROCOPY_LEAD,
  SEE_IT_FIRST_HREF,
  SEE_IT_FIRST_LABEL,
  START_FREE_LABEL,
} from '@/components/marketing/copy';
import { WORK_VIEWS } from '@/components/marketing/features-content';
import { CitedAnswer } from '@/components/marketing/home/cited-answer';
import { HomeMotion } from '@/components/marketing/home/home-motion';
import {
  HOME_ASK_SHOT,
  HOME_BOARD_SHOT,
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
import { PublicAnalyticsChoice } from '@/components/public-analytics';
import { PublicFooter } from '@/components/public-footer';
import { PublicHeader } from '@/components/public-header';
import { PublicSessionBranch } from '@/components/public-session-branch';
import { PRODUCT_POSITIONING } from '@/lib/product-positioning';
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
const HERO_INTRO = PRODUCT_POSITIONING.hero;
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
    'team daily log',
    'linked answers',
    'Slack and Telegram work record',
    'meeting transcript search',
    'project status AI',
  ],
};

function getHomeDocument() {
  const document = PUBLIC_DOCUMENT_REGISTRY.get('/');
  if (!document) throw new Error('The public document registry is missing the landing page');
  return document;
}

const LOGIN_EVENTS = PUBLIC_DEMO_STORY.landing.events;

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
      <PublicAnalyticsChoice />
      <main id="main" tabIndex={-1}>
        <ClaimScene />
        <IntakeScene />
        <TimelineScene />
        <AnswerScene />
        <OrganisedScene />
        <AgentScene />
        <AudienceScene />
        <UseCaseOverview />
        <CtaScene />
      </main>
      <PublicFooter currentSection="product" />
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
      <div className={styles.heroOpening}>
        <div className={styles.heroCopy}>
          <h1 id="claim-title" className={styles.heroTitle}>
            Know where the work stands.
          </h1>
          <div className={styles.heroSupporting}>
            <div>
              <p className={styles.heroIntro}>{PRODUCT_POSITIONING.promise}</p>
              <p className={styles.heroMechanism}>{HERO_INTRO}</p>
            </div>
            <div>
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
              <div className={styles.heroMeta}>
                <PublicSessionBranch
                  signedOut={
                    <p className={styles.ctaFinePrint}>
                      {CTA_MICROCOPY_LEAD}{' '}
                      <Link href="/pricing" className={styles.textLink}>
                        See pricing
                      </Link>
                    </p>
                  }
                  signedIn={null}
                />
                <GitHubSourceLink appearance="inline" className={styles.heroGithubLink} />
              </div>
            </div>
          </div>
        </div>

        <TimelineFlowDiagram
          variant="hero"
          disclosure="Illustrative flow · Only sources your team selects or sends enter."
        />
      </div>
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
      <h2 id="use-case-overview-title" className={styles.chooserHeading}>
        Know what you can tell the customer.
      </h2>
      <p className={styles.overviewIntro}>
        Before the next customer call, ask what engineering merged, what changed in scope and what
        still needs checking. Follow the sources before you make a commitment.
      </p>
      <div className={styles.audienceRail}>
        {USE_CASES.map((useCase) => (
          <Link href={useCase.route} key={useCase.route}>
            <h3>{useCase.title}</h3>
            <p>{useCase.cardBody}</p>
            <span aria-hidden="true">→</span>
          </Link>
        ))}
      </div>
      <Link href="/use-cases" className={styles.textLink}>
        Explore use cases
      </Link>
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
        id="intake-title"
        title={<>Work happens across tools. Keeping up should be easier.</>}
        copy="A decision in chat. An owner agreed in a call. A fix merged while you were doing something else. Choose which channels and sources to connect. Supported activity arrives automatically, and you can add notes or documents when useful."
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
        id="timeline-title"
        title={<>Follow the work as it changes.</>}
        copy="One login issue goes from a report in chat to an investigation and a linked change. A call is one optional source."
      />
      <div className={styles.timelineStage} data-home-panel-motion>
        <div className={styles.timelineHeader}>
          <span>Login issue · Illustrative example</span>
          <span>{LOGIN_EVENTS.length} sources</span>
        </div>
        <ol className={styles.timelineList}>
          {LOGIN_EVENTS.map((event) => (
            <li key={event.id} id={`login-source-${event.id}`}>
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
        id="answer-title"
        title={<>Ask where things stand.</>}
        copy="Read the daily update, ask a question or open the relevant record. “What did I work on this week?” and “What changed, and what still needs following up?” both draw on captured activity you can see."
      />
      <CitedAnswer />
      <HomeProof shot={HOME_ASK_SHOT} align="copy-first" />
      <HomeProof shot={HOME_DIGEST_SHOT} align="shot-first" />
    </section>
  );
}

function AgentScene() {
  return (
    <section className={styles.scene} aria-labelledby="agent-title">
      <SceneHeading
        id="agent-title"
        title={<>Your agents work from the same record.</>}
        copy="An agent can find why the login change was made and leave the next person a place to continue."
      />
      <div className={styles.audienceRail}>
        <article className={styles.recordCard}>
          <h3>Agent progress note</h3>
          <p>
            “I checked the staging login flow. The customer’s environment still needs verification.”
          </p>
        </article>
        <article className={styles.recordCard}>
          <h3>Later answer</h3>
          <p>
            The agent reported a successful staging check. Follow up after release to confirm the
            customer can log in.
          </p>
        </article>
      </div>
      <Link href="/agents" className={styles.textLink}>
        For AI agents
      </Link>
    </section>
  );
}

function OrganisedScene() {
  return (
    <section className={styles.scene} aria-labelledby="organised-title" data-scene="05-organised">
      <SceneHeading
        id="organised-title"
        title={<>Open a view when you need it.</>}
        copy="Tasks, people and projects stay connected to the activity behind them. Open a board to see the work, or ask for the answer directly."
      />
      <HomeProof shot={HOME_BOARD_SHOT} align="shot-first" />
      <div className={styles.recordShowcase} aria-label="Connected work records">
        <div className={styles.recordFlow} aria-label="Illustrative task update">
          <strong>Investigate the login issue</strong>
          <span>Slack report · Unassigned</span>
          <span>Meeting note · Priya · Planned Friday</span>
          <span>Linked PR merged · Verification open</span>
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
      <div className={styles.audienceRail}>
        {WORK_VIEWS.map((view) => (
          <Link key={view.href} href={view.href}>
            <h3>{view.title}</h3>
            <p>{view.body}</p>
            <span aria-hidden="true">→</span>
          </Link>
        ))}
      </div>
      <HomeProof shot={HOME_CLIENT_SHOT} align="shot-first" />
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
        id="trust-title"
        title={<>See what changed and why.</>}
        copy="Eligible routine changes can apply automatically under your workspace policy. See what changed and why in the record history. Changes that need a decision appear in Approvals."
      />
      <div
        className={styles.trustFlowPanel}
        data-home-panel-motion
        aria-labelledby="trust-flow-title"
      >
        <header>
          <h3 id="trust-flow-title">Every answer carries its evidence chain.</h3>
          <div className={styles.trustIntro}>
            <p>
              Access is checked when a source is retrieved. The answer only uses evidence you can
              see.
            </p>
            <p>
              Hosted by us, self-hosted from the source-available GitHub repo, or a managed
              on-premise deployment we run for you — see{' '}
              <Link href="/trust#deployment" className={styles.textLink}>
                deployment options
              </Link>
              .
            </p>
            <Link href="/trust" className={styles.trustCta}>
              Explore trust &amp; security <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </header>
        <ol className={styles.trustFlow}>
          {TRUST_FLOW_STEPS.map((step, index) => {
            const Icon = [Mail, FileText, ShieldCheck, CheckSquare][index] ?? FileText;
            return (
              <li key={step.index}>
                <div className={styles.trustCardTop}>
                  <Icon size={24} aria-hidden="true" />
                  <span>{step.index}</span>
                </div>
                <strong>{step.title}</strong>
                <small>{step.detail}</small>
              </li>
            );
          })}
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
          <h2 id="cta-title">Start with the tools your team already uses.</h2>
          <p>Connect a source and ask about the work happening there.</p>
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
          sizes="(min-width: 1280px) 800px, (min-width: 960px) 62vw, calc(100vw - 3rem)"
        />
      </div>
    </div>
  );
}

function SceneHeading({ id, title, copy }: { id: string; title: ReactNode; copy: string }) {
  return (
    <header className={styles.sceneHeading}>
      <div>
        <h2 id={id}>{title}</h2>
        <p>{copy}</p>
      </div>
    </header>
  );
}
