import {
  Briefcase,
  CalendarDays,
  FileText,
  GitPullRequest,
  LifeBuoy,
  Mail,
  MessageCircle,
  Send,
  Video,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { IntegrationCloud } from '@/app/_integration-cloud';
import { Logo, Wordmark } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth';
import { getLegalContactEmail } from '@/lib/legal-versions';
import { getSiteUrl } from '@/lib/site-url';
import { cn } from '@/lib/utils';

const SITE_NAME = 'The Timeline';
const SITE_TAGLINE = 'The work becomes the record';
const SITE_DESCRIPTION =
  'Capture work as it happens through Slack, Telegram, meetings, docs, email, and connected tools, then generate cited updates, digests, handoffs, answers, and work memory from the evidence.';

export const metadata: Metadata = {
  title: `${SITE_NAME} — ${SITE_TAGLINE}`,
  description: SITE_DESCRIPTION,
  keywords: [
    'operational memory',
    'event history',
    'evidence-based updates',
    'voice-first capture',
    'AI knowledge base',
    'CRM alternative',
    'cited AI answers',
    'meeting transcript search',
    'Telegram bot CRM',
    'Slack bot ingest',
    'team timeline',
    'organizational memory',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description:
      'Stop manually reporting on work your team already did. Timeline shows up as a Slack or Telegram bot, joins calls, and generates updates, digests, handoffs, and answers from evidence.',
    type: 'website',
    siteName: SITE_NAME,
    url: '/',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'The Timeline — the work becomes the record',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description:
      'Timeline shows up as a Slack or Telegram bot, joins calls, and generates updates, digests, handoffs, and answers from evidence.',
    images: ['/twitter-image'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-snippet': -1, 'max-image-preview': 'large' },
  },
};

const CONTACT_HREF = '/help/support';
const JSON_SCRIPT_ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
};

const WORK_SURFACES = [
  { label: 'Telegram bot', icon: Send },
  { label: 'Slack bot', icon: MessageCircle },
  { label: 'Meeting notes', icon: Video },
  { label: 'Email', icon: Mail },
  { label: 'Documents', icon: FileText },
  { label: 'Calendar', icon: CalendarDays },
  { label: 'Projects', icon: Briefcase },
  { label: 'Code', icon: GitPullRequest },
  { label: 'Support', icon: LifeBuoy },
  { label: 'MCP tools', icon: Wrench },
] as const;

export default async function LandingPage() {
  const session = await auth();
  const isSignedIn = Boolean(session?.user);

  return (
    <div className="min-h-screen bg-bg text-fg">
      <StructuredData />
      <TopNav isSignedIn={isSignedIn} />
      <main id="main">
        <Hero isSignedIn={isSignedIn} />
        <Problem />
        <Solution />
        <Surfaces />
        <Integrations />
        <Receipts />
        <Principles />
        <Faq />
        <FinalCTA isSignedIn={isSignedIn} />
      </main>
      <Footer isSignedIn={isSignedIn} />
    </div>
  );
}

function StructuredData() {
  const legalContactEmail = getLegalContactEmail();
  const siteUrl = getSiteUrl();
  const logoUrl = new URL('/icon.svg', siteUrl).toString();
  const ogImageUrl = new URL('/opengraph-image', siteUrl).toString();
  const orgId = `${siteUrl}/#organization`;
  const siteId = `${siteUrl}/#website`;
  const appId = `${siteUrl}/#software`;
  const pageId = `${siteUrl}/#webpage`;
  const organization: Record<string, string> = {
    '@type': 'Organization',
    '@id': orgId,
    name: SITE_NAME,
    url: siteUrl,
    logo: logoUrl,
  };
  if (legalContactEmail) {
    organization.email = legalContactEmail;
  }
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
        name: `${SITE_NAME} — ${SITE_TAGLINE}`,
        description: SITE_DESCRIPTION,
        image: ogImageUrl,
        isPartOf: { '@id': siteId },
        about: { '@id': appId },
        primaryImageOfPage: {
          '@type': 'ImageObject',
          url: ogImageUrl,
          width: 1200,
          height: 630,
        },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': appId,
        name: SITE_NAME,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web, iOS, Android',
        description: SITE_DESCRIPTION,
        url: siteUrl,
        image: ogImageUrl,
        publisher: { '@id': orgId },
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        featureList: [
          'Voice-, chat-, and email-first capture',
          'Evidence-generated updates, daily digests, handoffs, and answers',
          'Telegram bot ingest with /ask agent',
          'Slack bot ingest with /ask and @Timeline agent answers',
          'Email ingest via Postmark',
          'Calendar events in the same operational timeline',
          'Document drive with version history',
          'Meeting bot joins Google Meet, Microsoft Teams, and Zoom calls for notes and transcripts',
          'Agent answers with auditable citations',
          'Team-scoped vector + structured storage',
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: FAQ_ITEMS.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
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
  return JSON.stringify(value).replace(/[<>&]/g, (char) => JSON_SCRIPT_ESCAPES[char] ?? char);
}

const FAQ_ITEMS = [
  {
    q: 'What is The Timeline?',
    a: 'The Timeline is an evidence-derived operating record for teams. It can show up as a Slack or Telegram bot, join calls to take notes and transcribe meetings, ingest forwarded emails and document uploads, and compile the event history into updates, digests, handoffs, answers, and project or client memory. Every answer the agent returns is cited back to the raw event it came from.',
  },
  {
    q: 'Who is The Timeline for?',
    a: 'Small to mid-sized teams doing work where context loss creates client risk, delivery drag, or leadership noise: agencies, consultancies, implementation teams, account success teams, product teams, and founder-led operations. The kind of team where one person being out of the loop on a client or project conversation creates real friction.',
  },
  {
    q: 'How is The Timeline different from a CRM, wiki, or ticket board?',
    a: 'Existing tools punish recording. CRMs require the contact, deal stage, and next step before you can log a single sentence. Wikis demand a page hierarchy. Ticket boards demand a project and status. The Timeline inverts this: capture is unstructured, output is structured. The agent extracts objects (people, companies, projects, deals, tasks, documents), facts, relationships, and changes from raw input, then proposes approval-backed state only when the evidence is durable.',
  },
  {
    q: 'How is capture done?',
    a: 'Work surfaces feed one pipeline. Telegram and Slack bots capture chat, voice, files, /ask, and @Timeline context. Meeting bots join Google Meet, Zoom, and Microsoft Teams calls to take notes and transcribe discussions. Email, documents, calendar events, web notes, project tools, code systems, support queues, account systems, and internal tools all become part of the same evidence model. MCP servers extend the agent into long-tail systems and internal tools.',
  },
  {
    q: 'What models power the agent?',
    a: 'Chat, embeddings, and transcription run through OpenRouter via a single inference abstraction (llm.chat, llm.embed, llm.transcribe). Chat models are swappable per task. The embedding model is pinned to text-embedding-3-small at 1536 dimensions — changing it invalidates the index, so it only changes via a documented re-embed procedure.',
  },
  {
    q: 'Where does my data live?',
    a: 'Postgres holds events, facts, objects, tasks, documents, and version history. Qdrant holds vectors in a shared collection with mandatory team_id payload filters on every query. RustFS (S3-compatible) holds original blobs and audio with versioning enabled day one. Every row, every vector, and every byte carries a team_id, enforced at the data layer rather than application logic.',
  },
  {
    q: 'How are answers cited?',
    a: 'A single raw event ("Met with John from Apple about licensing") produces multiple facts — Tim met John, the topic was licensing, the date was today — each linked back to the source event. When the agent answers a question, it surfaces inline citation chips that resolve to the raw voice memo, email, message, or document version, with the author, timestamp, and source attached. No black-box summaries.',
  },
  {
    q: 'How does privacy work inside a team?',
    a: 'Visibility lives on the event, not the team. Each event carries one of three modes: private (visible only to the author or source owner), team (visible to all team members), or specific_users (a named list). A brain dump captured in a team group chat can still be marked private. Team isolation is enforced at the query layer; per-event visibility is layered on top.',
  },
  {
    q: 'Can I export my team data?',
    a: 'Yes — full team data export is treated as a trust requirement, not a feature flag. Raw events are immutable and append-only, which makes export deterministic. The roadmap places portability ahead of growth-side features.',
  },
  {
    q: 'Is The Timeline end-to-end encrypted?',
    a: 'No. The agent processes content server-side, which is structurally incompatible with end-to-end encryption. Data is encrypted in transit and at rest. The privacy boundary is per-event visibility plus team scoping enforced at the data layer.',
  },
];

/* ────────────────────────────────────────────────────────────────────────── */
/*  Primitives                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn('font-mono text-[11px] uppercase tracking-[0.16em] text-fg-dim', className)}
    >
      {children}
    </span>
  );
}

function IndexStrip({ children }: { children: ReactNode }) {
  return (
    <div className="border-y border-border py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">
      {children}
    </div>
  );
}

function CitationChipStatic({ id }: { id: string }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-signal/30 bg-signal-soft px-1 py-0.5 font-mono text-[0.85em] leading-none text-signal">
      [{id}]
    </span>
  );
}

function Section({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn('border-t border-border px-6 py-20 sm:py-28', className)}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Sections                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

function TopNav({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link href="/" aria-label="The Timeline — home" className="text-fg">
          <Wordmark compact />
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="#solution"
            className="hidden px-3 py-2 text-fg-muted transition-colors hover:text-fg sm:inline"
          >
            Product
          </Link>
          <Link
            href="#surfaces"
            className="hidden px-3 py-2 text-fg-muted transition-colors hover:text-fg sm:inline"
          >
            Surfaces
          </Link>
          <Link
            href="/help"
            className="hidden px-3 py-2 text-fg-muted transition-colors hover:text-fg sm:inline"
          >
            Docs
          </Link>
          <Link
            href={CONTACT_HREF}
            className="hidden px-3 py-2 text-fg-muted transition-colors hover:text-fg md:inline"
          >
            Contact
          </Link>
          {isSignedIn ? null : (
            <Link
              href="/sign-in"
              className="whitespace-nowrap px-3 py-2 text-fg-muted transition-colors hover:text-fg"
            >
              Sign in
            </Link>
          )}
          <ThemeToggle className="text-fg-muted hover:text-fg" />
          <Button asChild size="sm">
            <Link href={isSignedIn ? '/app' : '/sign-up'}>
              {isSignedIn ? 'Go to dashboard' : 'Create team'}
            </Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}

function Hero({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <section className="px-6 pb-24 pt-16 sm:pt-24">
      <div className="mx-auto max-w-6xl">
        <Mono>THE TIMELINE · EVENT HISTORY · OPERATIONAL MEMORY</Mono>
        <div className="mt-8 grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Your team
              <br />
              does the work.
              <br />
              <span className="text-signal">Timeline</span>
              <br />
              writes the update.
            </h1>
            <p className="mt-8 max-w-prose text-lg leading-relaxed text-fg-muted">
              Use Timeline as a Slack or Telegram bot, let it join calls to take notes, and connect
              docs, emails, tasks, and account conversations. It turns that work into cited updates,
              daily digests, handoffs, stakeholder answers, and project or client memory.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href={isSignedIn ? '/app' : '/sign-up'}>
                  {isSignedIn ? 'Go to dashboard →' : 'Create your team →'}
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href={CONTACT_HREF}>Talk to us</a>
              </Button>
              {isSignedIn ? null : (
                <Link
                  href="/sign-in"
                  className="px-3 py-2 text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline"
                >
                  Sign in
                </Link>
              )}
            </div>
            <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
              CAPTURED · CITED · APPROVAL-BACKED
            </p>
          </div>
          <HeroMock />
        </div>
        <WorkSurfaceStrip />
      </div>
    </section>
  );
}

function WorkSurfaceStrip() {
  return (
    <div className="mt-14 border-y border-border py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-dim">
          Work surfaces
        </span>
        {WORK_SURFACES.map(({ label, icon: Icon }) => (
          <span
            key={label}
            className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted"
          >
            <Icon className="size-3.5 text-fg-dim" aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function HeroMock() {
  return (
    <div className="border border-border bg-surface" aria-hidden>
      <div className="border-b border-border bg-surface-2 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">
        ACME PROJECT MEMORY · 2,847 EVENTS · LAST 14d
      </div>
      <ol className="divide-y divide-border">
        <li className="grid grid-cols-[88px_1fr] gap-4 px-4 py-3 font-mono text-xs">
          <span className="text-fg-dim">14:02 · MEET</span>
          <span className="font-sans text-sm text-fg">
            Acme asked for SSO before launch; Priya agreed to confirm timeline by Friday.
          </span>
        </li>
        <li className="grid grid-cols-[88px_1fr] gap-4 px-4 py-3 font-mono text-xs">
          <span className="text-fg-dim">11:47 · SLACK</span>
          <span className="font-sans text-sm text-fg">
            Design approved the onboarding copy; implementation unblocked.
          </span>
        </li>
        <li className="grid grid-cols-[88px_1fr] gap-4 px-4 py-3 font-mono text-xs">
          <span className="text-fg-dim">09:15 · DOC</span>
          <span className="font-sans text-sm text-fg">
            <em>Acme launch checklist</em> updated with migration owner and rollout window.
          </span>
        </li>
      </ol>
      <div className="border-t border-border bg-surface-2/60 p-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
          /ASK · AGENT REPLY
        </div>
        <p className="mt-2 text-sm leading-relaxed text-fg">
          Acme changed in three ways: SSO became the launch blocker{' '}
          <CitationChipStatic id="ev:1923" />
          , onboarding copy was approved <CitationChipStatic id="ev:1924" />, and the migration
          owner moved to Priya <CitationChipStatic id="doc:acme-checklist" />.
        </p>
      </div>
    </div>
  );
}

function Problem() {
  return (
    <Section id="problem">
      <Mono className="text-fg-muted">PROBLEM · DUPLICATE COMMUNICATION WORK</Mono>
      <h2 className="mt-6 max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
        Teams do the work, then separately report that the work happened.
      </h2>

      <div className="mt-12 grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-3">
        <IndictmentCell
          label="UPDATES"
          body="Stakeholders ask what changed, so someone reconstructs the story from Slack, docs, calls, and tasks."
        />
        <IndictmentCell
          label="DIGESTS"
          body="Daily or recurring summaries become another manual ritual layered on top of the actual work."
        />
        <IndictmentCell
          label="HANDOFFS"
          body="A teammate joins late and the team has to retell the project, account, and decision history."
        />
      </div>

      <p className="mt-10 max-w-prose text-base leading-[1.65] text-fg-muted">
        The result is predictable. CRMs, trackers, and wikis drift because they depend on people
        re-entering reality after the fact. Half the team&apos;s decisions live in threads no one
        can find. When someone asks <em>&ldquo;what changed with Acme?&rdquo;</em> the honest answer
        is <em>&ldquo;let me check with three people.&rdquo;</em>
      </p>

      <blockquote className="mt-10 max-w-2xl border-l-2 border-signal pl-5 text-lg italic leading-snug text-fg">
        The Timeline inverts it: capture work as it happens, then generate communication and memory
        from the evidence.
      </blockquote>
    </Section>
  );
}

function IndictmentCell({ label, body }: { label: string; body: string }) {
  return (
    <div className="bg-bg p-6 sm:p-8">
      <div className="font-mono text-xs uppercase tracking-[0.18em] text-signal">{label}</div>
      <p className="mt-4 text-base leading-[1.55] text-fg">{body}</p>
    </div>
  );
}

function Solution() {
  return (
    <Section id="solution">
      <IndexStrip>CONCEPTS · CAPTURE → EVIDENCE → OPERATIONAL MEMORY</IndexStrip>
      <ConceptDiagram />

      <div className="mt-10 max-w-3xl border-l-2 border-signal pl-5">
        <Mono className="text-signal">THE PAYOFF</Mono>
        <p className="mt-4 text-lg leading-snug text-fg">
          The output starts as updates, daily digests, handoffs, and answers. Over time it becomes
          project and client state: current, queryable, cited, and approval-backed.
        </p>
      </div>
    </Section>
  );
}

const INPUTS = [
  'TELEGRAM BOT',
  'SLACK BOT',
  'GOOGLE MEET / TEAMS / ZOOM',
  'EMAIL CC / BCC',
  'CALENDAR',
  'GITHUB / LINEAR / DRIVE',
  'WEB APP',
  'TEAM DOCUMENT DRIVE',
  'MCP SERVERS',
  'LONG-TAIL INTEGRATIONS',
] as const;

const WORKSPACE_OUTPUTS = [
  {
    label: 'EVENT HISTORY',
    detail: 'Who did what · when · source evidence',
    icon: '▤',
    delay: 3.0,
  },
  {
    label: 'UPDATES',
    detail: 'Stakeholder-ready answers · cited',
    icon: '⌬',
    delay: 3.45,
  },
  {
    label: 'DIGESTS',
    detail: 'What changed · what needs attention',
    icon: '◷',
    delay: 3.9,
  },
  {
    label: 'HANDOFFS',
    detail: 'Project and client context for teammates',
    icon: '◆',
    delay: 4.35,
  },
  {
    label: 'APPROVAL-BACKED STATE',
    detail: 'Objects · tasks · commitments · decisions',
    icon: '☑',
    delay: 4.8,
  },
] as const;

function ConceptDiagram() {
  return (
    <div aria-hidden className="cdg-root mt-10 border border-border bg-bg">
      {/* Top row: inputs · pipeline · workspace */}
      <div className="relative grid gap-px bg-border sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* INPUTS */}
        <div className="relative z-[1] bg-bg p-6 sm:p-7">
          <Mono>INPUTS</Mono>
          <ul className="mt-5 space-y-2.5">
            {INPUTS.map((label, i) => (
              <li
                key={label}
                className="flex items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted"
              >
                <span className="flex items-center gap-2">
                  <span className="inline-block size-1.5 rounded-full bg-fg-dim" />
                  {label}
                </span>
                <span
                  className="cdg-pulse inline-block size-1.5 rounded-full bg-signal"
                  style={{ animationDelay: `${i * 0.45}s` }}
                />
              </li>
            ))}
          </ul>
        </div>

        {/* PIPELINE */}
        <div className="relative z-[1] flex items-center justify-center bg-bg p-6 sm:p-7">
          <div className="inline-flex flex-col items-center gap-3 border border-border bg-surface px-6 py-5">
            <Mono className="text-signal">EXTRACT · AGENT</Mono>
            <div className="font-mono text-base text-fg-muted">
              <span className="cdg-dot" style={{ animationDelay: '0s' }}>
                ◇
              </span>{' '}
              <span className="cdg-dot" style={{ animationDelay: '0.3s' }}>
                ◇
              </span>{' '}
              <span className="cdg-dot" style={{ animationDelay: '0.6s' }}>
                ◇
              </span>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-dim">
              llm.chat · llm.embed · llm.transcribe
            </span>
          </div>
        </div>

        {/* WORKSPACE */}
        <div className="relative z-[1] bg-bg p-6 sm:p-7">
          <Mono>WORKSPACE</Mono>

          <div className="mt-5 space-y-2">
            {WORKSPACE_OUTPUTS.map((output) => (
              <LitRow key={output.label} delay={output.delay} dense>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
                    {output.icon} {output.label}
                  </span>
                  <span className="min-w-0 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim sm:text-right">
                    {output.detail}
                  </span>
                </div>
              </LitRow>
            ))}
          </div>
        </div>

        {/* Sweep line — sits behind content, crosses the full top row */}
        <span className="cdg-sweep" />
      </div>

      <style>{CDG_STYLES}</style>
    </div>
  );
}

function LitRow({
  id,
  children,
  delay,
  dense,
  className,
}: {
  id?: string;
  children: ReactNode;
  delay: number;
  dense?: boolean;
  className?: string;
}) {
  return (
    <div id={id} className={cn('relative', className)}>
      <div
        className="cdg-lit pointer-events-none absolute inset-0 border border-signal/30 bg-signal-soft"
        style={{ animationDelay: `${delay}s` }}
      />
      <div className={cn('relative', dense ? 'px-2 py-1' : 'px-3 py-2')}>{children}</div>
    </div>
  );
}

const CDG_STYLES = `
  .cdg-root { position: relative; overflow: hidden; }

  /* Default (and reduced-motion) state: everything reads as "settled / lit". */
  .cdg-lit { opacity: 1; }
  .cdg-sweep { display: none; }
  .cdg-pulse { opacity: 0.35; }
  .cdg-dot { opacity: 1; }

  @media (prefers-reduced-motion: no-preference) {
    .cdg-sweep {
      display: block;
      position: absolute;
      top: 0; bottom: 0;
      left: 0;
      width: 72px;
      pointer-events: none;
      background: linear-gradient(
        to right,
        transparent,
        color-mix(in oklch, var(--signal) 55%, transparent),
        transparent
      );
      animation: cdg-sweep 10s infinite linear;
      will-change: transform;
      z-index: 0;
    }

    .cdg-lit {
      opacity: 0;
      animation: cdg-lit 10s infinite ease-out;
    }
    .cdg-pulse {
      opacity: 0;
      animation: cdg-pulse 10s infinite ease-out;
    }
    .cdg-dot {
      animation: cdg-dotblink 10s infinite ease-in-out;
    }
  }

  /* translateX(N * 100cqw) requires container-query units; using vw is fine
     because the diagram never exceeds viewport width. Compositor-only. */
  @keyframes cdg-sweep {
    0%   { transform: translateX(-72px); opacity: 0; }
    8%   { opacity: 1; }
    35%  { opacity: 1; }
    45%  { transform: translateX(100vw); opacity: 0; }
    100% { transform: translateX(100vw); opacity: 0; }
  }

  @keyframes cdg-lit {
    0%, 28%   { opacity: 0; }
    34%       { opacity: 1; }
    92%       { opacity: 1; }
    98%, 100% { opacity: 0; }
  }

  @keyframes cdg-pulse {
    0%, 4%    { opacity: 0; transform: scale(0.4); }
    8%        { opacity: 1; transform: scale(1); }
    18%       { opacity: 0; transform: scale(0.4); }
    100%      { opacity: 0; transform: scale(0.4); }
  }

  @keyframes cdg-dotblink {
    0%, 12%   { opacity: 0.25; }
    20%       { opacity: 1; }
    40%       { opacity: 0.4; }
    50%       { opacity: 1; }
    100%      { opacity: 0.4; }
  }
`;

function Surfaces() {
  return (
    <Section id="surfaces">
      <IndexStrip>SURFACES · WORK GRAPH + EXTENSIBILITY</IndexStrip>
      <div className="mt-10 grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <SurfaceTile
          label="TELEGRAM"
          body="A Telegram bot captures voice memos, text, and attachments in DMs or team groups. /ask runs the same cited agent."
        />
        <SurfaceTile
          label="SLACK"
          body="A Slack bot captures DMs, bound channels, files, /ask, and @Timeline replies. Thread context becomes searchable memory."
        />
        <SurfaceTile
          label="MEET / ZOOM / TEAMS"
          body="Meeting bots join calls, take notes, transcribe discussions, and file decisions, tasks, and cited summaries."
        />
        <SurfaceTile
          label="EMAIL"
          body="Forward, CC, or BCC to your team address. Parsed mail lands beside chat and meetings."
        />
        <SurfaceTile
          label="CALENDAR"
          body="Scheduled work, all-day events, and time-aware context appear in the same timeline."
        />
        <SurfaceTile
          label="PROJECTS / CODE / DOCS"
          body="Project updates, document changes, issues, PRs, releases, CI, and delivery events become cited evidence."
        />
        <SurfaceTile
          label="WEB APP"
          body="Typed notes, audio uploads, drag-drop files, approvals, and cited agent chat."
        />
        <SurfaceTile
          label="DRIVE UPLOAD"
          body="Team folders with version history. Uploads and edits become searchable document events."
        />
        <SurfaceTile
          label="MCP + INTEGRATIONS"
          body="Connect internal tools and long-tail SaaS through MCP, alongside first-party integrations for the systems your team uses most."
        />
      </div>
    </Section>
  );
}

function SurfaceTile({ label, body }: { label: string; body: string }) {
  return (
    <div className="bg-bg p-6 sm:p-8">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-fg">{label}</span>
      </div>
      <p className="mt-4 text-base leading-[1.55] text-fg-muted">{body}</p>
    </div>
  );
}

function Integrations() {
  return (
    <Section id="integrations">
      <IndexStrip>INTEGRATIONS · KEEP YOUR CURRENT TOOLS</IndexStrip>
      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr,2fr] lg:items-start">
        <div className="space-y-4">
          <h2 className="text-2xl font-medium tracking-tight text-fg sm:text-3xl">
            Timeline sits beside the stack before it replaces any manual upkeep.
          </h2>
          <p className="text-base leading-[1.55] text-fg-muted">
            Conversations, meetings, docs, projects, code, account systems, support queues,
            calendars, and internal tools feed the same event history. Teams keep their current
            tools while Timeline generates cited updates, digests, handoffs, and answers from the
            work already happening there. It can be present as a Slack or Telegram bot, join calls
            as a note-taker, and still plug long-tail tools in as{' '}
            <a
              href="https://modelcontextprotocol.io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-fg underline-offset-4 hover:underline"
            >
              MCP servers
            </a>{' '}
            : Notion, Jira, Figma, Sentry, Stripe, your internal tool, anything that speaks the
            protocol. Timeline is designed around the work graph, not one vendor's idea of a system
            of record.
          </p>
        </div>
        <IntegrationCloud />
      </div>
    </Section>
  );
}

function Receipts() {
  return (
    <Section id="receipts" className="bg-surface">
      <IndexStrip>EVIDENCE · EVERY CLAIM IS CITED</IndexStrip>
      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <div>
          <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Ask what changed. See the receipts.
          </h2>
          <p className="mt-6 max-w-prose text-base leading-[1.65] text-fg-muted">
            Every fact resolves to a raw event: voice memo, Slack or Telegram message, email,
            document version, with author, timestamp, and source. Click the chip; the inspector
            shows exactly what was said.
          </p>
          <blockquote className="mt-8 max-w-prose border-l-2 border-signal pl-5 text-lg italic leading-snug text-fg">
            Re-run the extraction with a better model tomorrow — the raw event never changes, the
            citations always resolve.
          </blockquote>
        </div>
        <div className="border border-border bg-bg" aria-hidden>
          <div className="border-b border-border bg-surface-2 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">
            /ASK · TEAM acme
          </div>
          <div className="border-b border-border p-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">YOU</div>
            <p className="mt-1 text-sm text-fg">
              What changed with Acme, and what did we promise next?
            </p>
          </div>
          <div className="p-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-signal">
              AGENT
            </div>
            <p className="mt-1 text-sm leading-relaxed text-fg">
              SSO became the launch blocker in yesterday&apos;s meeting{' '}
              <CitationChipStatic id="ev:1923" />. Design approved onboarding copy in Slack{' '}
              <CitationChipStatic id="ev:1924" />. Priya owns the migration checklist update{' '}
              <CitationChipStatic id="doc:acme-checklist" />.
            </p>
          </div>
          <div className="border-t border-border bg-surface-2/60 p-4 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">
            INSPECTOR · ev:1923 · MEETING · ACME · 14:02 · 0:38
          </div>
        </div>
      </div>
    </Section>
  );
}

function Principles() {
  return (
    <Section id="principles">
      <IndexStrip>PRINCIPLES · BUILT FOR THE WORK</IndexStrip>
      <dl className="mt-10 divide-y divide-border border-y border-border">
        <PrincipleRow
          term="Raw events are immutable."
          desc="What was said goes in as-is and never changes. Derived facts are regenerable; the source is sacred."
        />
        <PrincipleRow
          term="Privacy is per-event, not per-team."
          desc="A brain dump can stay private even inside a team channel. Visibility lives on the event."
        />
        <PrincipleRow
          term="Team-scoped end to end."
          desc="Every query, every vector, every byte carries a team_id. Enforced at the data layer, not the UI."
        />
        <PrincipleRow
          term="One inference layer."
          desc="Chat, embeddings, transcription — all through a single provider abstraction. Embedding model is pinned for index integrity."
        />
      </dl>
    </Section>
  );
}

function PrincipleRow({ term, desc }: { term: string; desc: string }) {
  return (
    <div className="grid gap-4 py-6 sm:grid-cols-[280px_1fr] sm:gap-12 sm:py-8">
      <dt className="text-lg font-semibold leading-snug tracking-tight">{term}</dt>
      <dd className="text-base leading-[1.6] text-fg-muted">{desc}</dd>
    </div>
  );
}

function Faq() {
  return (
    <Section id="faq">
      <IndexStrip>FAQ</IndexStrip>
      <div className="mt-10 divide-y divide-border border-y border-border">
        {FAQ_ITEMS.map((item) => (
          <details key={item.q} className="group">
            <summary className="flex cursor-pointer items-center justify-between gap-6 py-5 font-mono text-sm uppercase tracking-[0.1em] text-fg transition-colors hover:text-signal">
              <span>{item.q}</span>
              <span
                aria-hidden
                className="font-mono text-fg-dim transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="max-w-prose pb-6 pr-8 text-base leading-[1.65] text-fg-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

function FinalCTA({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <Section id="cta" className="bg-surface">
      <div className="border-l-2 border-signal pl-6 sm:pl-10">
        <Mono className="text-signal">READY?</Mono>
        <h2 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          Try it on one real project.
        </h2>
        <p className="mt-5 max-w-2xl text-base leading-[1.65] text-fg-muted">
          Add Timeline to the conversations and calls where work already happens, then connect the
          surrounding tools. Timeline will generate the next update, digest, handoff, and answer
          from the evidence.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href={isSignedIn ? '/app' : '/sign-up'}>
              {isSignedIn ? 'Go to dashboard →' : 'Create your team →'}
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href={CONTACT_HREF}>Talk to us</a>
          </Button>
        </div>
        <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
          CAPTURED · CITED · APPROVAL-BACKED
        </p>
      </div>
    </Section>
  );
}

function Footer({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <footer className="border-t border-border px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
        <span className="inline-flex items-center gap-2 text-fg-dim">
          <Logo ariaHidden className="size-4" />
          THE TIMELINE · v1 · 2026
        </span>
        <nav className="flex flex-wrap items-center gap-5">
          <Link href="#solution" className="hover:text-fg">
            Product
          </Link>
          <Link href="#surfaces" className="hover:text-fg">
            Surfaces
          </Link>
          <Link href="#faq" className="hover:text-fg">
            FAQ
          </Link>
          <Link href="/help" className="hover:text-fg">
            Docs
          </Link>
          <Link href="/terms" className="hover:text-fg">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-fg">
            Privacy
          </Link>
          <Link href={CONTACT_HREF} className="hover:text-fg">
            Contact
          </Link>
          <Link href={isSignedIn ? '/app' : '/sign-in'} className="hover:text-fg">
            {isSignedIn ? 'Dashboard' : 'Sign in'}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
