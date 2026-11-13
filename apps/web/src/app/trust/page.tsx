import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import styles from './trust.module.css';

import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import { MarketingDisclosure } from '@/components/marketing/marketing-disclosure';
import { MarketingContainer } from '@/components/marketing/marketing-layout';
import { PublicShell } from '@/components/public-shell';
import { SupportMailto } from '@/components/support-email-provider';
import { buildPublicStructuredData, metadataForPublicDocument } from '@/lib/public-site';
import { TRUST_DOCUMENT } from '@/lib/public-site/documents';
import { getSiteUrl } from '@/lib/site-url';
import {
  PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS,
  TRUST_AI_PRIVACY_LABELS,
  TRUST_AI_ROUTES,
} from '@/lib/trust-claims';

export const metadata = metadataForPublicDocument(TRUST_DOCUMENT);

const TRUST_SIGNALS = [
  {
    label: 'AI content retention',
    value: PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS.trustSignalValue,
    detail: PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS.trustSignalDetail,
  },
  {
    label: 'Model training',
    value: 'Prohibited by policy',
    detail: 'Timeline policy prohibits using Customer Content to train or fine-tune models.',
  },
  {
    label: 'Meeting media',
    value: '1 hour requested',
    detail: 'Recall.ai processes it; Timeline stores the transcript, not the call recording.',
  },
  {
    label: 'Advertising trackers',
    value: 'None',
    detail:
      'No behavioral advertising, heatmaps, or replay. Optional public analytics requires consent.',
  },
] as const;

const DATA_PATH = [
  {
    title: 'Capture is deliberate',
    body: 'People send work to Timeline or an administrator selects a provider resource. Connected does not mean imported by default.',
  },
  {
    title: 'One team boundary',
    body: 'PostgreSQL records, Qdrant vectors, and RustFS objects keep team identity attached. Visibility narrows access again inside the team.',
  },
  {
    title: 'AI processing has defined limits',
    body: PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS.trustDataPath,
  },
  {
    title: 'Answers stay inspectable',
    body: 'Derived summaries can change; captured evidence remains attached so a person can check the original source and visibility.',
  },
] as const;

const PROVIDERS = [
  [
    'Railway',
    'Application and worker hosting, PostgreSQL, Redis, Qdrant vector search, and RustFS object storage',
  ],
  ['OpenRouter', 'Privacy-filtered routing to eligible AI inference endpoints'],
  [
    'Recall.ai',
    'Meeting attendance and transcript generation; Timeline requests one-hour media retention',
  ],
  ['Daytona', 'Ephemeral isolated compute for document extraction'],
  ['Firecrawl', 'Fetches public pages of a website URL submitted during first-run onboarding'],
  ['Resend', 'Transactional and inbound email'],
  ['Polar', 'Merchant of record for checkout, subscriptions, invoices and transaction taxes'],
  [
    'PostHog',
    'Personless surface totals, pseudonymous product events, and optional public-browser analytics after consent',
  ],
  ['Sentry', 'Minimized error diagnostics with targeted credential and URL redaction'],
  ['Cloudflare Turnstile', 'Abuse prevention on public forms and password signup'],
] as const;

function TrustProvidersSection() {
  return (
    <section id="processors" tabIndex={-1} className="border-b border-border">
      <MarketingContainer className="py-10 sm:py-14">
        <div className={styles.sectionBody}>
          <div>
            <h2 className={styles.heading}>Which services process hosted data?</h2>
            <p className="mt-5 max-w-3xl text-base leading-8 text-fg-muted">
              Services you connect receive only the data and permissions needed for that connection.
              The register below lists the hosted service’s core processors.
            </p>
            <MarketingDisclosure summary="View processors and their roles">
              <div className="mt-10 overflow-hidden border-y border-border">
                {PROVIDERS.map(([provider, purpose]) => (
                  <div
                    key={provider}
                    className="grid gap-2 border-b border-border py-5 last:border-b-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-8"
                  >
                    <h3 className="font-semibold text-fg">{provider}</h3>
                    <p className="text-sm leading-7 text-fg-muted">{purpose}</p>
                  </div>
                ))}
              </div>
            </MarketingDisclosure>
            <nav aria-labelledby="trust-legal-heading" className="mt-10">
              <h3 id="trust-legal-heading" className="text-xl font-semibold">
                Legal documents
              </h3>
              <ul className="mt-4 grid gap-4 text-sm leading-7 text-fg-muted">
                <li>
                  <Link className="text-fg underline underline-offset-4" href="/privacy">
                    Privacy Policy
                  </Link>{' '}
                  — data use, retention, providers, transfers, and your rights.
                </li>
                <li>
                  <Link className="text-fg underline underline-offset-4" href="/terms">
                    Terms of Use
                  </Link>{' '}
                  — service commitments and responsibilities.
                </li>
                <li>
                  <Link className="text-fg underline underline-offset-4" href="/cookies">
                    Cookies and similar technologies
                  </Link>{' '}
                  — browser storage and analytics choices.
                </li>
              </ul>
            </nav>
          </div>
        </div>
      </MarketingContainer>
    </section>
  );
}

function TrustAssuranceSection() {
  return (
    <section id="assurance" tabIndex={-1} className="border-b border-border bg-surface/45">
      <MarketingContainer className="py-10 sm:py-14">
        <div className={styles.sectionBody}>
          <div>
            <h2 className={styles.heading}>What assurance is available today?</h2>
            <div className={styles.assurance}>
              <article className={styles.assuranceItem}>
                <h3 className="mt-5 text-2xl font-semibold tracking-[-0.035em]">
                  Controls in the application
                </h3>
                <p className="mt-4 text-base leading-7 text-fg-muted">
                  Public source, team and visibility boundaries, encrypted secrets, meeting consent
                  controls, and a maintained provider register.
                </p>
                <p className="mt-4 text-base leading-7 text-fg-muted">
                  These application controls are not an independent security audit of the hosted
                  service.
                </p>
                <MarketingDisclosure summary="Analytics boundaries">
                  <p>
                    Browser analytics is confined to reviewed public pages and waits for affirmative
                    consent; protected workspace routes do not load it.
                  </p>
                  <p>
                    Personless surface streams and pseudonymous product events use separate server
                    paths.
                  </p>
                </MarketingDisclosure>
              </article>
              <article className={styles.assuranceItem}>
                <h3 className="mt-5 text-2xl font-semibold tracking-[-0.035em]">
                  Independent assurance and regulated data
                </h3>
                <p className="mt-4 text-sm leading-7 text-fg-muted">
                  Timeline does not currently claim a SOC 2 report, ISO 27001 certification, or
                  HIPAA compliance. Do not submit highly regulated or special-category data without
                  Timeline&apos;s express prior written approval for your use case.
                </p>
              </article>
            </div>
            <p className="mt-7 text-sm leading-7 text-fg-muted">
              Report suspected vulnerabilities privately to{' '}
              <SupportMailto
                className="text-fg underline underline-offset-4"
                subject="[Security] Vulnerability report"
              />
              . Do not put credentials, customer data, or an undisclosed exploit in a public issue.
            </p>
          </div>
        </div>
      </MarketingContainer>
    </section>
  );
}

function TrustDeploymentSection() {
  return (
    <section id="deployment" tabIndex={-1} className="bg-surface">
      <MarketingContainer className="grid gap-10 py-10 sm:py-14 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <h2 className="mt-5 max-w-4xl text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
            Can you inspect or control the deployment?
          </h2>
          <p className="mt-5 max-w-3xl text-base leading-8 text-fg-muted">
            The repository is public so teams can inspect architecture, open issues, and propose
            security patches. If the hosted boundary is not enough, contact us about a dedicated or
            self-managed deployment and the terms that apply.
          </p>
        </div>
        <div className="flex flex-col items-start gap-4 lg:items-end">
          <a
            href="https://github.com/timborovkov/the-timeline-ai"
            className="inline-flex min-h-12 items-center gap-6 rounded-sm bg-signal px-5 font-semibold text-signal-fg outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Inspect the source
            <ArrowRight aria-hidden="true" className="size-4" />
          </a>
          <Link
            href="/help/support"
            className="rounded-sm text-sm font-semibold text-fg underline decoration-border-strong underline-offset-4 outline-none hover:decoration-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Discuss a controlled deployment
          </Link>
        </div>
      </MarketingContainer>
    </section>
  );
}

export default function TrustPage() {
  const structuredData = buildPublicStructuredData(TRUST_DOCUMENT, getSiteUrl());

  return (
    <PublicShell width="wide" currentSection="trust" footerLabel="The Timeline trust center">
      <main id="main" tabIndex={-1} className={styles.page}>
        <EditorialStructuredData data={structuredData} />

        <section className="border-b border-border">
          <MarketingContainer className="py-10 sm:py-14">
            <div className={styles.hero}>
              <h1 className={styles.title}>Trust, security &amp; data privacy.</h1>
              <div className="max-w-[46ch] space-y-5 text-base leading-8 text-fg-muted sm:text-lg">
                <p>
                  How Timeline handles your work, which providers process it, and the policies that
                  govern its use.
                </p>
                <p>
                  Relevant content is sent to service providers to deliver requested features.
                  Timeline policy prohibits using Customer Content to train or fine-tune models.{' '}
                  {PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS.trustIntro}
                </p>
              </div>
            </div>

            <nav aria-label="Trust topics" className={styles.topics}>
              {[
                ['data-path', 'Data & evidence'],
                ['ai-retention', 'AI & retention'],
                ['access-deletion', 'Access & deletion'],
                ['processors', 'Processors & policies'],
                ['assurance', 'Assurance'],
                ['deployment', 'Deployment'],
              ].map(([id, label]) => (
                <a key={id} href={`#${id}`}>
                  {label}
                  <ArrowRight aria-hidden="true" className="size-4" />
                </a>
              ))}
            </nav>
            <dl className={styles.facts}>
              {TRUST_SIGNALS.map((signal) => (
                <div key={signal.label}>
                  <dt>{signal.label}</dt>
                  <dd className={styles.factValue}>{signal.value}</dd>
                  <dd>{signal.detail}</dd>
                </div>
              ))}
            </dl>
            <p className={styles.assuranceNote}>
              Timeline does not currently claim a SOC 2 report, ISO 27001 certification, or HIPAA
              compliance. <a href="#assurance">Read the assurance status</a>.
            </p>
          </MarketingContainer>
        </section>

        <section id="data-path" tabIndex={-1} className="border-b border-border bg-surface/45">
          <MarketingContainer className="py-10 sm:py-14">
            <div className={styles.sectionBody}>
              <div>
                <h2 className={styles.heading}>What happens to captured work?</h2>
                <ol className="mt-10 border-y border-border">
                  {DATA_PATH.map((step) => (
                    <li key={step.title} className={styles.evidenceRow}>
                      <h3 className="text-xl font-semibold tracking-[-0.025em]">{step.title}</h3>
                      <p className="max-w-2xl text-sm leading-7 text-fg-muted">{step.body}</p>
                    </li>
                  ))}
                </ol>
                <h3 className="mt-8 text-xl font-semibold">What Timeline preserves</h3>
                <dl className={styles.preserved}>
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
                <p className="mt-6 text-base leading-7 text-fg-muted">
                  Timeline preserves source content, checks access at retrieval, and keeps citations
                  attached to the answer. If evidence suggests a lasting workspace change, Timeline
                  proposes it for human review instead of applying it on its own.
                </p>
              </div>
            </div>
          </MarketingContainer>
        </section>

        <section id="ai-retention" tabIndex={-1} className="border-b border-border">
          <MarketingContainer className="py-10 sm:py-14">
            <div className={styles.sectionBody}>
              <div>
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8">
                  <div>
                    <h2 className={styles.heading}>How does AI process and retain data?</h2>
                    <p className="mt-5 max-w-[70ch] text-base leading-7 text-fg-muted">
                      Text, multimodal and embedding roles require eligible ZDR endpoints and fail
                      closed rather than accept weaker retention.
                    </p>
                    <MarketingDisclosure summary="AI request controls and transcription retention">
                      <p>
                        OpenRouter and an upstream endpoint process the input needed for each AI
                        feature. OpenRouter may select among eligible ZDR upstreams.
                      </p>
                      <p>
                        Supported calls send <code>data_collection: deny</code>,{' '}
                        <code>zdr: true</code>, and an explicit cache-disable control.
                      </p>
                      <p>
                        These request controls do not independently verify provider-account settings
                        or provider deletion.
                      </p>
                      <p>{PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS.trustDetail}</p>
                    </MarketingDisclosure>
                  </div>
                  <div className="border-t border-border">
                    {TRUST_AI_ROUTES.map((route) => (
                      <div
                        key={route.job}
                        className="grid gap-3 border-b border-border py-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] sm:gap-8"
                      >
                        <p className="font-medium text-fg">{route.job}</p>
                        <div>
                          <code className="break-all text-xs leading-6 text-fg-muted">
                            {route.model}
                          </code>
                          <p className="mt-2 text-xs font-semibold text-fg">
                            {TRUST_AI_PRIVACY_LABELS[route.privacyMode]}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-fg-muted">{route.selection}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="mt-6 text-sm leading-7 text-fg-muted">
                  ZDR-required roles reject endpoints with weaker retention terms.{' '}
                  {PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS.trustChecklist}
                </p>
              </div>
            </div>
          </MarketingContainer>
        </section>

        <section
          id="access-deletion"
          tabIndex={-1}
          className="border-b border-border bg-surface/45"
        >
          <MarketingContainer className="py-10 sm:py-14">
            <div className={styles.sectionBody}>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-10">
                <div>
                  <h2 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                    Who can access your work?
                  </h2>
                  <p className="mt-5 text-base leading-8 text-fg-muted">
                    The hosted architecture uses Railway for the web app, workers, PostgreSQL,
                    Redis, Qdrant vector search, and RustFS object storage.
                  </p>
                  <p className="mt-4 max-w-[70ch] text-base leading-7 text-fg-muted">
                    Application file transfers use team authorization and short-lived signed URLs.
                    OAuth, API, and MCP secrets use AES-256-GCM authenticated encryption at rest.
                  </p>
                </div>
                <div>
                  <h3 className="text-xl font-semibold">Staff access and deletion policy</h3>
                  <p className="mt-5 max-w-[70ch] text-base leading-7 text-fg-muted">
                    Staff policy prohibits routine workspace browsing. Access must serve a permitted
                    purpose and be limited to what the task needs.
                  </p>
                  <MarketingDisclosure summary="Read the staff access and deletion policy">
                    <p>
                      Timeline&apos;s staff access policy prohibits routine browsing of customer
                      workspaces. It permits access only for user-requested support, service
                      reliability, security response, legal compliance, or another documented
                      operational need. The policy requires access to be limited to what the task
                      needs.
                    </p>
                    <p>
                      Customer team owners and administrators do not receive general access to
                      another member&apos;s private content.
                    </p>
                    <p>
                      Separately authorized Timeline staff may use a temporary support session as a
                      selected member for a permitted purpose.
                    </p>
                    <p>
                      That session can read the member&apos;s private content and make changes
                      within the member&apos;s permissions.
                    </p>
                    <p>
                      It does not grant access to other members&apos; private content that the
                      selected member cannot see.
                    </p>
                    <p>
                      These support sessions expire after 30 minutes and require a recorded purpose,
                      ticket or incident reference, and authorization or emergency context.
                    </p>
                    <p>We record the staff identity separately from the member identity.</p>
                    <p>Inspection of suspended accounts or teams is read-only.</p>
                    <p>
                      Team owners can request permanent deletion in Team settings, immediately
                      disabling access for all members.
                    </p>
                    <p>
                      Disabling preserves data while pausing processing and new usage accrual, and
                      requests cancellation of subscription renewal.
                    </p>
                    <p>
                      Platform administrators can restore access before permanent deletion starts.
                    </p>
                    <p>
                      Deletion removes operational team content, files, search vectors and team
                      connections through a tracked cleanup process.
                    </p>
                    <p>User accounts, other teams and original external files remain.</p>
                    <p>
                      Limited financial and security records, backups and provider copies have
                      separate retention or deletion requirements; active-system cleanup is not a
                      claim of immediate erasure everywhere.
                    </p>
                    <p>
                      Ordinary support requires customer authorization; emergency access remains
                      subject to subsequent review under our staff policy.
                    </p>
                  </MarketingDisclosure>
                </div>
              </div>
            </div>
          </MarketingContainer>
        </section>

        <TrustProvidersSection />
        <TrustAssuranceSection />
        <TrustDeploymentSection />
      </main>
    </PublicShell>
  );
}
