import Link from 'next/link';

import { AssociationLine } from './_concept-association-line';
import { IntegrationCloud } from './_integration-cloud';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Logo, Wordmark } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const SITE_NAME = 'The Timeline';
const SITE_TAGLINE = 'The operations log your team can talk to';
const SITE_DESCRIPTION =
  'Multi-tenant team memory: voice-, chat-, and email-first capture, agentically compiled into a searchable history of who did what — with auditable citations on every answer.';

export const metadata: Metadata = {
  title: `${SITE_NAME} — ${SITE_TAGLINE}`,
  description: SITE_DESCRIPTION,
  keywords: [
    'team memory',
    'operations log',
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
      'Stop updating the CRM. Capture work as it happens; the agent files it. Every answer cited back to the raw event.',
    type: 'website',
    siteName: SITE_NAME,
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description:
      'Stop updating the CRM. Capture work as it happens; the agent files it. Every answer cited back to the raw event.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-snippet': -1, 'max-image-preview': 'large' },
  },
};

const CONTACT_HREF = '/help/support';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <StructuredData />
      <TopNav />
      <main id="main">
        <Hero />
        <Problem />
        <Solution />
        <HowItWorks />
        <Surfaces />
        <Integrations />
        <Receipts />
        <Principles />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}

function StructuredData() {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': '#org',
        name: SITE_NAME,
        url: '/',
        email: 'tim@irmin.co',
      },
      {
        '@type': 'WebSite',
        '@id': '#site',
        url: '/',
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        publisher: { '@id': '#org' },
      },
      {
        '@type': 'SoftwareApplication',
        name: SITE_NAME,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web, iOS, Android',
        description: SITE_DESCRIPTION,
        url: '/',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        featureList: [
          'Voice-, chat-, and email-first capture',
          'Telegram bot ingest with /ask agent',
          'Slack bot ingest with /ask and @Timeline agent answers',
          'Email ingest via Postmark',
          'Document drive with version history',
          'Meeting transcripts from Google Meet, Microsoft Teams, and Zoom (Recall.ai)',
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
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}

const FAQ_ITEMS = [
  {
    q: 'What is The Timeline?',
    a: 'The Timeline is a multi-tenant team memory and object management system. Team members capture work as it happens — voice notes, forwarded emails, Telegram and Slack messages, meeting transcripts, document uploads — and the agent compiles a searchable, queryable history of who did what, talked to whom, decided what, and what changed. Every answer the agent returns is cited back to the raw event it came from.',
  },
  {
    q: 'Who is The Timeline for?',
    a: 'Small to mid-sized teams of 5 to 50 people doing knowledge work where context compounds: sales, consulting, product, and founding teams. The kind of team where one person being out of the loop on a client conversation creates real friction. A team member can record a voice note and have it queryable via the agent within 60 seconds of pressing send.',
  },
  {
    q: 'How is The Timeline different from a CRM, wiki, or ticket board?',
    a: 'Existing tools punish recording. CRMs require the contact, deal stage, and next step before you can log a single sentence. Wikis demand a page hierarchy. Ticket boards demand a project and status. The Timeline inverts this: capture is unstructured, output is structured. The agent extracts objects (people, companies, projects, deals, tasks, documents), facts, relationships, and changes from raw input — and resolves them against everything your team has ever said.',
  },
  {
    q: 'How is capture done?',
    a: 'Six surfaces feed one pipeline. (1) Web and PWA: typed notes, audio uploads, drag-drop documents. (2) Telegram bot: voice memos and text in DMs or team groups; /ask runs the same agent as web chat. (3) Slack bot: DMs, bound channels, file attachments, /ask, and @Timeline threaded answers. (4) Email: forward, CC, or BCC to your team address, parsed by Postmark. (5) Document drive: team folders with version history. (6) Meeting bots (Google Meet, Microsoft Teams, Zoom via Recall.ai) — transcripts and action items land in the same pipeline as voice memos.',
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
    a: 'Visibility lives on the event, not the team. Each event carries one of three modes: private (visible only to the author), team (visible to all team members), or specific_users (a named list). A brain dump captured in a team group chat can still be marked private. Team isolation is enforced at the query layer; per-event visibility is layered on top.',
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

function TopNav() {
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
            href="#how-it-works"
            className="hidden px-3 py-2 text-fg-muted transition-colors hover:text-fg sm:inline"
          >
            How it works
          </Link>
          <Link href="/sign-in" className="px-3 py-2 text-fg-muted transition-colors hover:text-fg">
            Sign in
          </Link>
          <ThemeToggle className="text-fg-muted hover:text-fg" />
          <Button asChild size="sm">
            <Link href="/sign-up">Create team</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="px-6 pb-24 pt-16 sm:pt-24">
      <div className="mx-auto max-w-6xl">
        <Mono>THE TIMELINE · OPERATIONAL ARCHIVE · v1</Mono>
        <div className="mt-8 grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Nobody updates
              <br />
              the CRM.
              <br />
              <span className="text-signal">The Timeline</span>
              <br />
              updates itself.
            </h1>
            <p className="mt-8 max-w-prose text-lg leading-relaxed text-fg-muted">
              Voice-note the call in Telegram. Capture the Slack thread. Forward the email. Drop a
              Meet, Teams, or Zoom link. The agent extracts who, what, and when — reconciled against
              everything your team has ever said. Ask anything; every answer cites its source.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/sign-up">Create your team →</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href={CONTACT_HREF}>Talk to us</a>
              </Button>
              <Link
                href="/sign-in"
                className="px-3 py-2 text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline"
              >
                Sign in
              </Link>
            </div>
            <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
              INDEXED · CITED · NEVER FORGOTTEN
            </p>
          </div>
          <HeroMock />
        </div>
      </div>
    </section>
  );
}

function HeroMock() {
  return (
    <div className="border border-border bg-surface" aria-hidden>
      <div className="border-b border-border bg-surface-2 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">
        TIMELINE · 2,847 EVENTS · LAST 14d · TEAM acme
      </div>
      <ol className="divide-y divide-border">
        <li className="grid grid-cols-[88px_1fr] gap-4 px-4 py-3 font-mono text-xs">
          <span className="text-fg-dim">14:02 · VOICE</span>
          <span className="font-sans text-sm text-fg">
            Tim → John Ternus (Apple) — agreed on revised SaaS licensing terms; deck by Friday.
          </span>
        </li>
        <li className="grid grid-cols-[88px_1fr] gap-4 px-4 py-3 font-mono text-xs">
          <span className="text-fg-dim">11:47 · EMAIL</span>
          <span className="font-sans text-sm text-fg">
            Acme: signed renewal arrived. Auto-linked to Acme deal.
          </span>
        </li>
        <li className="grid grid-cols-[88px_1fr] gap-4 px-4 py-3 font-mono text-xs">
          <span className="text-fg-dim">09:15 · TELEGRAM</span>
          <span className="font-sans text-sm text-fg">
            Otto uploaded <em>Office Rules v3.pdf</em> — TikTok section added.
          </span>
        </li>
      </ol>
      <div className="border-t border-border bg-surface-2/60 p-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
          /ASK · AGENT REPLY
        </div>
        <p className="mt-2 text-sm leading-relaxed text-fg">
          On the Apple licensing deal: Tim and John Ternus aligned on revised terms this afternoon{' '}
          <CitationChipStatic id="ev:1923" />. Tim owes a revised deck by Friday{' '}
          <CitationChipStatic id="ev:1924" />.
        </p>
      </div>
    </div>
  );
}

function Problem() {
  return (
    <Section id="problem">
      <Mono className="text-fg-muted">PROBLEM · WHY NOTHING STAYS UPDATED</Mono>
      <h2 className="mt-6 max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
        Every tool you have punishes recording.
      </h2>

      <div className="mt-12 grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-3">
        <IndictmentCell
          label="CRM"
          body="Wants the contact, the deal stage, the next step, the amount, the close date. Before you can log a single sentence."
        />
        <IndictmentCell
          label="WIKI"
          body="Wants a page hierarchy, a parent, a template, a tag. Before you can write the thing down."
        />
        <IndictmentCell
          label="TICKETS"
          body="Want a project, a status, an assignee, a priority. Before you can flag what just broke."
        />
      </div>

      <p className="mt-10 max-w-prose text-base leading-[1.65] text-fg-muted">
        The result is predictable. Nobody updates the CRM. The wiki is three months stale. Half the
        team&apos;s decisions live in Slack threads no one can find. When someone asks{' '}
        <em>&ldquo;what happened with Acme?&rdquo;</em> the only honest answer is{' '}
        <em>&ldquo;let me check with three people.&rdquo;</em>
      </p>

      <blockquote className="mt-10 max-w-2xl border-l-2 border-signal pl-5 text-lg italic leading-snug text-fg">
        The Timeline inverts it: capture is unstructured, output is structured. You talk; it files.
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
      <IndexStrip>SOLUTION · THREE MOVES</IndexStrip>
      <div className="mt-10 grid gap-10 sm:grid-cols-3 sm:gap-12">
        <Pillar
          n="01"
          title="Capture is voice-first."
          body="Three taps in Telegram, or a Slack DM while the thread is still warm. No forms, no schemas, no &ldquo;which project does this belong to.&rdquo;"
        />
        <Pillar
          n="02"
          title="Objects and tasks, derived from what you said."
          body="The agent reads raw events and resolves them into objects — people, companies, deals, projects, documents — plus the tasks that fall out."
        />
        <Pillar
          n="03"
          title="Every answer is cited."
          body="No black-box summaries. Click any claim, see the raw event it came from with author, timestamp, and source."
        />
      </div>

      <div className="mt-20">
        <IndexStrip>CONCEPTS · HOW IT FITS TOGETHER</IndexStrip>
        <ConceptDiagram />

        <div className="mt-10 max-w-3xl border-l-2 border-signal pl-5">
          <Mono className="text-signal">THE PAYOFF</Mono>
          <p className="mt-4 text-lg leading-snug text-fg">
            The output looks like a CRM, a project tracker, and a doc index — current, queryable,
            cited. You just never had to update it.
          </p>
        </div>
      </div>
    </Section>
  );
}

const INPUTS = [
  'TELEGRAM',
  'SLACK',
  'GOOGLE MEET / ZOOM / TEAMS',
  'EMAIL',
  'WEB APP',
  'DRIVE UPLOAD',
  'MCP SERVERS',
  '3RD PARTY INTEGRATIONS',
] as const;

const WORKSPACE_OBJECTS = [
  { chip: 'obj:apple-q2', name: 'Apple', type: 'DEAL' },
  { chip: 'obj:john-ternus', name: 'John Ternus', type: 'PERSON' },
  { chip: 'task:revise-deck', name: 'Revise deck by Fri', type: 'TASK' },
  { chip: 'obj:office-rules', name: 'Office Rules', type: 'DOCUMENT' },
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
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-fg-dim" />
                  {label}
                </span>
                <span
                  className="cdg-pulse inline-block h-1.5 w-1.5 rounded-full bg-signal"
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

          {/* TIMELINE */}
          <LitRow delay={3.0} className="mt-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
                ▤ TIMELINE
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
                2,847 EVENTS · CITED
              </span>
            </div>
          </LitRow>

          {/* OBJECTS group */}
          <div className="mt-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
              ◆ OBJECTS
            </div>
            <div data-cdg-objects="" className="relative mt-2 space-y-1.5 pl-3">
              {WORKSPACE_OBJECTS.map((o, i) => (
                <LitRow
                  key={o.chip}
                  id={`cdg-row-${o.chip.replace(/[^a-zA-Z0-9]/g, '-')}`}
                  delay={3.5 + i * 0.45}
                  dense
                >
                  <div className="flex items-center gap-2 text-sm">
                    <CitationChipStatic id={o.chip} />
                    <span className="text-fg">{o.name}</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-dim">
                      · {o.type}
                    </span>
                  </div>
                </LitRow>
              ))}
              {/* Association line: measured at runtime between the two row IDs;
                  resilient to LitRow padding changes. */}
              <AssociationLine
                fromId="cdg-row-obj-apple-q2"
                toId="cdg-row-obj-john-ternus"
                containerSelector="[data-cdg-objects]"
                label="↳ related"
              />
            </div>
          </div>

          {/* AGENT Q&A */}
          <LitRow delay={5.8} className="mt-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
                ⌬ AGENT Q&A
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
                /ASK · CITED ANSWERS
              </span>
            </div>
          </LitRow>
        </div>

        {/* Sweep line — sits behind content, crosses the full top row */}
        <span className="cdg-sweep" />
      </div>

      {/* Drop connectors — animate "everything settles into the drive".
          Mobile: single grouped line. Desktop: three columns. */}
      <div className="relative h-6 bg-bg sm:hidden">
        <span
          className="cdg-drop absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-fg-dim/60"
          style={{ animationDelay: '5.6s' }}
        />
      </div>
      <div className="relative hidden h-6 gap-px bg-border sm:grid sm:grid-cols-3">
        <div className="relative bg-bg">
          <span
            className="cdg-drop absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-fg-dim/60"
            style={{ animationDelay: '5.5s' }}
          />
        </div>
        <div className="relative bg-bg">
          <span
            className="cdg-drop absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-fg-dim/60"
            style={{ animationDelay: '5.7s' }}
          />
        </div>
        <div className="relative bg-bg">
          <span
            className="cdg-drop absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-fg-dim/60"
            style={{ animationDelay: '5.9s' }}
          />
        </div>
      </div>

      {/* DRIVE foundation strip */}
      <div className="border-t border-border bg-surface px-6 py-5 sm:px-7">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <Mono className="text-fg">▣ TEAM DOCUMENT DRIVE</Mono>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-dim">
            FOUNDATION · TEAM-SCOPED
          </span>
        </div>
        <p className="mt-2 text-sm leading-[1.6] text-fg-muted">
          Immutable raw events · versioned blobs · vectors · the storage layer everything else rests
          on.
        </p>
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
  .cdg-assoc { opacity: 1; }
  .cdg-assoc-label { opacity: 1; }
  .cdg-drop { opacity: 0.55; }
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
    .cdg-assoc {
      opacity: 0;
      animation: cdg-assoc 10s infinite ease-out;
    }
    .cdg-assoc-label {
      opacity: 0;
      animation: cdg-assoc 10s infinite ease-out;
    }
    .cdg-drop {
      opacity: 0;
      animation: cdg-drop 10s infinite ease-out;
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

  @keyframes cdg-assoc {
    0%, 52%   { opacity: 0; }
    58%       { opacity: 1; }
    92%       { opacity: 1; }
    98%, 100% { opacity: 0; }
  }

  @keyframes cdg-drop {
    0%, 52%   { opacity: 0; }
    62%       { opacity: 0.55; }
    92%       { opacity: 0.55; }
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

function Pillar({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div>
      <div className="font-mono text-xs uppercase tracking-[0.18em] text-fg-dim">{n}</div>
      <h3 className="mt-3 text-xl font-semibold leading-snug tracking-tight">{title}</h3>
      <p className="mt-3 text-base leading-[1.6] text-fg-muted">{body}</p>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: '01',
      title: 'Land',
      body: 'Voice memo, Slack, Telegram, email, upload, or meeting bot. Immutable raw event, team-scoped.',
    },
    {
      n: '02',
      title: 'Extract',
      body: 'Audio → text. Text → objects, facts, relationships, tasks. Every fact links to its source event.',
    },
    {
      n: '03',
      title: 'Index',
      body: 'Vectors in Qdrant, structured facts in Postgres, originals in object storage. Always team-scoped.',
    },
    {
      n: '04',
      title: 'Ask',
      body: 'Agent answers in the web app, Telegram via /ask, or Slack via /ask and @Timeline. Citations on every claim.',
    },
  ];
  return (
    <Section id="how-it-works">
      <IndexStrip>PIPELINE · INGEST → INDEX → ANSWER</IndexStrip>
      <ol className="mt-10 grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <li key={s.n} className="bg-bg p-6 sm:p-8">
            <div className="font-mono text-xs uppercase tracking-[0.18em] text-signal">
              {s.n} · {s.title.toUpperCase()}
            </div>
            <p className="mt-4 text-base leading-[1.55] text-fg-muted">{s.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Surfaces() {
  return (
    <Section id="surfaces">
      <IndexStrip>SURFACES · ONE PIPELINE, MANY MOUTHS</IndexStrip>
      <div className="mt-10 grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        <SurfaceTile
          label="WEB & PWA"
          body="Typed notes, audio uploads, drag-drop documents. Same shortcuts everywhere."
        />
        <SurfaceTile
          label="TELEGRAM BOT"
          body="Voice memos and text in DMs or team groups. /ask runs the same agent as web chat."
        />
        <SurfaceTile
          label="SLACK BOT"
          body="DMs and bound channels become timeline events. /ask is private; @Timeline replies in-thread."
        />
        <SurfaceTile label="EMAIL" body="Forward, CC, or BCC to your team address." />
        <SurfaceTile
          label="DOCUMENT DRIVE"
          body="Team folders with version history. Uploads and edits become timeline events."
        />
        <SurfaceTile
          label="MEETING BOTS"
          body="Paste a Meet, Teams, or Zoom link. A silent Recall.ai bot joins, transcribes, and files decisions and tasks."
        />
        <SurfaceTile
          label="CUSTOM MCP"
          coming
          body="Connect internal tools or any third-party MCP server. No bespoke connectors."
        />
      </div>
    </Section>
  );
}

function SurfaceTile({ label, body, coming }: { label: string; body: string; coming?: boolean }) {
  return (
    <div className="bg-bg p-6 sm:p-8">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-fg">{label}</span>
        {coming && (
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-dim">
            · coming soon
          </span>
        )}
      </div>
      <p className="mt-4 text-base leading-[1.55] text-fg-muted">{body}</p>
    </div>
  );
}

function Integrations() {
  return (
    <Section id="integrations">
      <IndexStrip>INTEGRATIONS · BRING YOUR WHOLE STACK</IndexStrip>
      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr,2fr] lg:items-start">
        <div className="space-y-4">
          <h2 className="text-2xl font-medium tracking-tight text-fg sm:text-3xl">
            Every system the team works in feeds the same timeline.
          </h2>
          <p className="text-base leading-[1.55] text-fg-muted">
            Native sync for Drive, Linear, and GitHub. Anything else plugs in as an{' '}
            <a
              href="https://modelcontextprotocol.io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-fg underline-offset-4 hover:underline"
            >
              MCP server
            </a>{' '}
            — Notion, Slack, Jira, Figma, Sentry, Stripe, your internal tool, anything that speaks
            the protocol. The agent gets the tools; you don&apos;t write a connector.
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
      <IndexStrip>AUDIT · EVERY CLAIM IS CITED</IndexStrip>
      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <div>
          <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Ask. See the receipts.
          </h2>
          <p className="mt-6 max-w-prose text-base leading-[1.65] text-fg-muted">
            Every fact resolves to a raw event — voice memo, Slack or Telegram message, email,
            document version — with author, timestamp, and source. Click the chip; the inspector
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
              What did we agree with Ternus on the licensing deal?
            </p>
          </div>
          <div className="p-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-signal">
              AGENT
            </div>
            <p className="mt-1 text-sm leading-relaxed text-fg">
              Revised SaaS licensing terms agreed in this afternoon&apos;s call{' '}
              <CitationChipStatic id="ev:1923" />. Tim owes John a revised deck by Friday{' '}
              <CitationChipStatic id="ev:1924" />. The original term sheet sits on the Apple deal
              object <CitationChipStatic id="obj:apple-q2" />.
            </p>
          </div>
          <div className="border-t border-border bg-surface-2/60 p-4 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">
            INSPECTOR · ev:1923 · VOICE · TIM · 14:02 · 0:38
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

function FAQ() {
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

function FinalCTA() {
  return (
    <Section id="cta" className="bg-surface">
      <div className="border-l-2 border-signal pl-6 sm:pl-10">
        <Mono className="text-signal">READY?</Mono>
        <h2 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          Capture five days. See what the agent saw.
        </h2>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href="/sign-up">Create your team →</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href={CONTACT_HREF}>Talk to us</a>
          </Button>
        </div>
        <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
          INDEXED · CITED · NEVER FORGOTTEN
        </p>
      </div>
    </Section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
        <span className="inline-flex items-center gap-2 text-fg-dim">
          <Logo ariaHidden className="h-4 w-4" />
          THE TIMELINE · v1 · 2026
        </span>
        <nav className="flex flex-wrap items-center gap-5">
          <Link href="#solution" className="hover:text-fg">
            Product
          </Link>
          <Link href="#how-it-works" className="hover:text-fg">
            How it works
          </Link>
          <Link href="#faq" className="hover:text-fg">
            FAQ
          </Link>
          <Link href="/sign-in" className="hover:text-fg">
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  );
}
