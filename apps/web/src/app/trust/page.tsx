import { ArrowRight, Check, Minus } from 'lucide-react';
import Link from 'next/link';

import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import { MarketingContainer, MarketingSectionGrid } from '@/components/marketing/marketing-layout';
import { MarketingSectionIndex } from '@/components/marketing/section-index';
import { PublicShell } from '@/components/public-shell';
import { auth } from '@/lib/auth';
import { getLegalContactEmail } from '@/lib/legal-versions';
import { buildPublicStructuredData, metadataForPublicDocument } from '@/lib/public-site';
import { TRUST_DOCUMENT } from '@/lib/public-site/documents';
import { getSiteUrl } from '@/lib/site-url';
import { TRUST_AI_ROUTES } from '@/lib/trust-claims';

export const metadata = metadataForPublicDocument(TRUST_DOCUMENT);

const TRUST_SIGNALS = [
  {
    label: 'AI content retention',
    value: 'Deployment-gated ZDR',
    detail: 'Hosted AI may start only after an operator confirms the key-bound ZDR guardrail.',
  },
  {
    label: 'Model training',
    value: 'Customer content excluded',
    detail: 'Timeline does not train or fine-tune any model on Customer Content.',
  },
  {
    label: 'Meeting media',
    value: '1 hour by default',
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
    title: 'Inference is transient',
    body: 'Only the content needed for a feature leaves Timeline. Hosted AI is deployment-gated on a key-bound guardrail; supported requests add ZDR filters and stop rather than request a weaker route.',
  },
  {
    title: 'Answers stay inspectable',
    body: 'Derived summaries can change; captured evidence remains attached so a person can check the original source and visibility.',
  },
] as const;

const PROVIDERS = [
  [
    'Railway',
    'App, workers, PostgreSQL, Redis, private server traffic, and the signed-file transfer endpoint',
  ],
  ['OpenRouter', 'Privacy-filtered routing to eligible AI inference endpoints'],
  [
    'Recall.ai',
    'Meeting attendance and transcript generation; one-hour media retention requested, with deployed account evidence pending',
  ],
  ['Daytona', 'Ephemeral isolated compute for document extraction'],
  ['Postmark', 'Transactional and inbound email'],
  [
    'PostHog',
    'Personless surface totals, pseudonymous product events, and consent-gated public-browser analytics; provider evidence remains pending',
  ],
  ['Sentry', 'Minimized error diagnostics with targeted credential and URL redaction'],
  ['Cloudflare Turnstile', 'Abuse prevention on public forms and password signup'],
] as const;

function TrustProvidersSection() {
  return (
    <section className="border-b border-border">
      <MarketingContainer className="py-16 sm:py-20">
        <MarketingSectionGrid>
          <MarketingSectionIndex index="04" label="Processors and retention" />
          <div>
            <h2 className="max-w-[18ch] text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
              The services that can touch hosted data.
            </h2>
            <p className="mt-5 max-w-3xl text-base leading-8 text-fg-muted">
              Core processors operate the hosted service. Services a customer deliberately
              connects—such as Slack, Google Drive, GitHub, or a custom MCP server—receive only the
              data and permissions needed for that connection.
            </p>
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
            <p className="mt-7 text-sm leading-7 text-fg-muted">
              Full categories, lawful bases, disclosures, transfer safeguards, and rights are in the{' '}
              <Link className="text-fg underline underline-offset-4" href="/privacy">
                Privacy Policy
              </Link>
              . Current browser storage and public analytics choices are in the{' '}
              <Link className="text-fg underline underline-offset-4" href="/cookies">
                Cookies and similar technologies notice
              </Link>
              . Contractual service commitments and use rules are in the{' '}
              <Link className="text-fg underline underline-offset-4" href="/terms">
                Terms of Use
              </Link>
              .
            </p>
          </div>
        </MarketingSectionGrid>
      </MarketingContainer>
    </section>
  );
}

function TrustAssuranceSection({ securityEmail }: { securityEmail: string }) {
  return (
    <section className="border-b border-border bg-surface/45">
      <MarketingContainer className="py-16 sm:py-20">
        <MarketingSectionGrid>
          <MarketingSectionIndex index="05" label="Assurance status" />
          <div>
            <h2 className="max-w-[19ch] text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
              We will show evidence when the evidence exists.
            </h2>
            <div className="mt-10 grid gap-px overflow-hidden border border-border bg-border md:grid-cols-2">
              <article className="bg-bg p-7 sm:p-8">
                <p className="flex items-center gap-2 font-mono text-[0.65rem] tracking-[0.1em] text-signal uppercase">
                  <Check aria-hidden="true" className="size-4" /> Current
                </p>
                <h3 className="mt-5 text-2xl font-semibold tracking-[-0.035em]">
                  Inspectable controls and candid status
                </h3>
                <p className="mt-4 text-sm leading-7 text-fg-muted">
                  Public source, team and visibility boundaries, encrypted secrets, meeting consent
                  controls, and a maintained provider register. Browser analytics is confined to
                  reviewed public pages and waits for affirmative consent; protected workspace
                  routes do not load it. Personless surface streams and pseudonymous product events
                  use separate server paths. Provider/account evidence and AI account evidence
                  remain deployment checklist items until captured.
                </p>
              </article>
              <article className="bg-bg p-7 sm:p-8">
                <p className="flex items-center gap-2 font-mono text-[0.65rem] tracking-[0.1em] text-fg-dim uppercase">
                  <Minus aria-hidden="true" className="size-4" /> Not claimed today
                </p>
                <h3 className="mt-5 text-2xl font-semibold tracking-[-0.035em]">
                  SOC 2, ISO 27001, or HIPAA compliance
                </h3>
                <p className="mt-4 text-sm leading-7 text-fg-muted">
                  We do not display badges we have not earned. GDPR is a legal framework, not a
                  certificate. Verified reports and certifications will appear here if and when they
                  are obtained.
                </p>
              </article>
            </div>
            <p className="mt-7 text-sm leading-7 text-fg-muted">
              Report suspected vulnerabilities privately to{' '}
              <a
                className="text-fg underline underline-offset-4"
                href={`mailto:${securityEmail}?subject=${encodeURIComponent('[Security] Vulnerability report')}`}
              >
                {securityEmail}
              </a>
              . Do not put credentials, customer data, or an undisclosed exploit in a public issue.
            </p>
          </div>
        </MarketingSectionGrid>
      </MarketingContainer>
    </section>
  );
}

function TrustDeploymentSection() {
  return (
    <section className="bg-surface">
      <MarketingContainer className="grid gap-10 py-16 sm:py-20 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <p className="text-sm font-medium text-fg-muted">Trust but verify</p>
          <h2 className="mt-5 max-w-4xl text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
            Inspect the source. Or ask for a deployment you control.
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

export default async function TrustPage() {
  const session = await auth();
  const structuredData = buildPublicStructuredData(TRUST_DOCUMENT, getSiteUrl());
  const securityEmail = getLegalContactEmail();

  return (
    <PublicShell
      isSignedIn={Boolean(session?.user)}
      width="expanded"
      footerLabel="The Timeline trust center"
    >
      <main id="main" tabIndex={-1}>
        <EditorialStructuredData data={structuredData} />

        <section className="border-b border-border">
          <MarketingContainer className="py-16 sm:py-24 lg:py-28">
            <p className="text-sm font-medium text-fg-muted">Trust / Security / Data privacy</p>
            <div className="mt-6 grid items-end gap-10 lg:grid-cols-[1.25fr_0.75fr]">
              <h1 className="max-w-[14ch] text-balance text-[3rem] font-semibold leading-[0.95] tracking-[-0.05em] text-fg sm:text-[clamp(3.5rem,5vw,5.5rem)]">
                Your work should not become someone else&apos;s training set.
              </h1>
              <div className="max-w-[46ch] space-y-5 text-base leading-8 text-fg-muted sm:text-lg">
                <p>
                  Timeline holds the messages, meetings, files, and decisions teams rarely put in
                  one place. Trust has to come from inspectable boundaries, candid provider choices,
                  and claims the product can actually enforce.
                </p>
                <p>
                  The honest answer is not “nothing leaves our servers.” Relevant content reaches
                  specialist processors. The promise is narrower: Timeline never trains or
                  fine-tunes models on Customer Content, and hosted AI may be enabled only after a
                  production key is bound to a zero-retention guardrail covering every model group
                  Timeline uses.
                </p>
              </div>
            </div>

            <dl className="mt-14 grid gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
              {TRUST_SIGNALS.map((signal) => (
                <div key={signal.label} className="bg-bg p-6 sm:p-7">
                  <dt className="font-mono text-[0.65rem] tracking-[0.1em] text-fg-dim uppercase">
                    {signal.label}
                  </dt>
                  <dd className="mt-5 text-xl font-semibold tracking-[-0.025em] text-fg">
                    {signal.value}
                  </dd>
                  <dd className="mt-3 text-sm leading-6 text-fg-muted">{signal.detail}</dd>
                </div>
              ))}
            </dl>
          </MarketingContainer>
        </section>

        <section className="border-b border-border bg-surface/45">
          <MarketingContainer className="py-16 sm:py-20">
            <MarketingSectionGrid>
              <MarketingSectionIndex index="01" label="Data path" />
              <div>
                <h2 className="max-w-[17ch] text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                  Boundaries follow the work from capture to answer.
                </h2>
                <ol className="mt-10 border-y border-border">
                  {DATA_PATH.map((step, index) => (
                    <li
                      key={step.title}
                      className="grid gap-3 border-b border-border py-7 last:border-b-0 sm:grid-cols-[3rem_minmax(0,0.7fr)_minmax(0,1fr)] sm:gap-6"
                    >
                      <span className="font-mono text-[0.68rem] tracking-[0.12em] text-signal">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <h3 className="text-xl font-semibold tracking-[-0.025em]">{step.title}</h3>
                      <p className="max-w-2xl text-sm leading-7 text-fg-muted">{step.body}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </MarketingSectionGrid>
          </MarketingContainer>
        </section>

        <section className="border-b border-border">
          <MarketingContainer className="py-16 sm:py-20">
            <MarketingSectionGrid>
              <MarketingSectionIndex index="02" label="AI and training" />
              <div>
                <div className="grid gap-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-14">
                  <div>
                    <h2 className="max-w-[15ch] text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                      Private routing, not a private-cloud fairy tale.
                    </h2>
                    <p className="mt-5 text-base leading-8 text-fg-muted">
                      OpenRouter and an upstream endpoint transiently process the necessary input.
                      The deployment policy requires a ZDR guardrail covering every model group
                      Timeline uses, bound to the production key, with prompt logging, input/output
                      sharing, and persistent response caching off. Application startup requires an
                      operator attestation; the live canary checks the pinned speech model against
                      OpenRouter&apos;s ZDR registry. Chat, media, and embedding calls also send{' '}
                      <code>data_collection: deny</code> and <code>zdr: true</code> per request.
                      Temporary in-memory provider caching can still occur; non-content metadata
                      such as model, tokens, latency, and cost can be retained.
                    </p>
                  </div>
                  <div className="border-t border-border">
                    {TRUST_AI_ROUTES.map((route) => (
                      <div
                        key={route.job}
                        className="grid gap-3 border-b border-border py-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] sm:gap-8"
                      >
                        <p className="font-medium text-fg">{route.job}</p>
                        <code className="break-all text-xs leading-6 text-fg-muted">
                          {route.model}
                        </code>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-10 grid gap-px border border-border bg-border sm:grid-cols-3">
                  {[
                    'No model training or fine-tuning on Customer Content',
                    'Selected ZDR endpoints prohibit persistent prompt and response storage',
                    'Hosted deployment must reject endpoints with weaker retention terms',
                  ].map((item) => (
                    <p key={item} className="flex gap-3 bg-bg p-5 text-sm leading-6 text-fg-muted">
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-signal" />
                      {item}
                    </p>
                  ))}
                </div>
              </div>
            </MarketingSectionGrid>
          </MarketingContainer>
        </section>

        <section className="border-b border-border bg-surface/45">
          <MarketingContainer className="py-16 sm:py-20">
            <MarketingSectionGrid>
              <MarketingSectionIndex index="03" label="Storage and access" />
              <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
                <div>
                  <h2 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                    Infrastructure with fewer hidden hops.
                  </h2>
                  <p className="mt-5 text-base leading-8 text-fg-muted">
                    Railway hosts the web app, workers, PostgreSQL, and Redis. Qdrant vector search
                    and RustFS object storage use Railway&apos;s private network for server traffic
                    and persistent volumes. RustFS also exposes HTTPS for team-authorized,
                    short-lived signed browser transfers; its buckets are not public. OAuth, API,
                    and MCP secrets use AES-256-GCM authenticated encryption at rest.
                  </p>
                </div>
                <div>
                  <h2 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                    People need a reason, not curiosity.
                  </h2>
                  <p className="mt-5 text-base leading-8 text-fg-muted">
                    Timeline personnel do not routinely browse customer workspaces. Authorized
                    access is limited to user-requested support, reliability, security response,
                    legal compliance, or another documented operational need. It must be
                    minimum-necessary and time-bounded where practical.
                  </p>
                  <p className="mt-5 text-sm leading-7 text-fg-muted">
                    Inside a team, records are team-visible, private, or restricted to named users.
                    Administrator status is not a general bypass into a member&apos;s private
                    context.
                  </p>
                </div>
              </div>
            </MarketingSectionGrid>
          </MarketingContainer>
        </section>

        <TrustProvidersSection />
        <TrustAssuranceSection securityEmail={securityEmail} />
        <TrustDeploymentSection />
      </main>
    </PublicShell>
  );
}
