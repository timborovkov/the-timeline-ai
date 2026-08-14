import { ArrowRight, Check, LockKeyhole, Minus, Sparkles } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import {
  findConnector,
  type ConnectorContent,
} from '@/components/marketing/integrations/connector-content';
import { ConnectorStructuredData } from '@/components/marketing/integrations/connector-seo';
import { RecordsToAnswer } from '@/components/marketing/integrations/records-to-answer';
import { PUBLIC_DEMO_DISCLOSURE } from '@/components/marketing/public-demo-story';
import { PublicShell } from '@/components/public-shell';
import { Button } from '@/components/ui/button';

export function ConnectorPage({
  connector,
  isSignedIn,
}: {
  connector: ConnectorContent;
  isSignedIn: boolean;
}) {
  return (
    <PublicShell
      isSignedIn={isSignedIn}
      footerLabel={`${connector.name} integration`}
      currentSection="integrations"
    >
      <ConnectorStructuredData connector={connector} />
      <main id="main" tabIndex={-1}>
        <ConnectorHero connector={connector} isSignedIn={isSignedIn} />
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <TruthBoundary connector={connector} />
          <Questions connector={connector} />
          <WorkedScenario connector={connector} />
          <CapturedRecords connector={connector} />
          <Recipes connector={connector} />
          <SetupAndPrivacy connector={connector} />
          <Limitations connector={connector} />
          <Faq connector={connector} />
          <Related connector={connector} />
          <FinalCta connector={connector} isSignedIn={isSignedIn} />
        </div>
      </main>
    </PublicShell>
  );
}

function ConnectorHero({
  connector,
  isSignedIn,
}: {
  connector: ConnectorContent;
  isSignedIn: boolean;
}) {
  return (
    <section className="overflow-hidden border-b border-border bg-bg">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:py-28">
        <Link
          href="/integrations"
          className="mb-10 inline-flex min-h-10 items-center rounded-sm text-sm font-medium text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          All integrations
        </Link>
        <div className="grid items-end gap-10 lg:grid-cols-[1.3fr_0.7fr]">
          <div>
            <div className="mb-7 flex items-center gap-4">
              <div
                className={`grid size-14 place-items-center rounded-md border border-border bg-surface sm:size-16 ${connector.lightLogoTileInDarkMode ? 'dark:bg-white' : ''}`}
              >
                <Image
                  src={connector.logo}
                  alt=""
                  width={38}
                  height={38}
                  className="size-8 sm:size-10"
                />
              </div>
              <div>
                <p className="text-sm font-medium text-fg-muted">Integration</p>
                <p className="mt-1 text-sm font-semibold text-fg">{connector.name}</p>
              </div>
            </div>
            <h1 className="max-w-[15ch] break-words text-balance text-[3rem] font-semibold leading-[0.95] tracking-[-0.05em] text-fg sm:text-[clamp(3.5rem,5vw,5.5rem)]">
              {connector.hero}
            </h1>
          </div>
          <div className="border-t border-border pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
            <p className="max-w-[46ch] text-base leading-relaxed text-fg-muted sm:text-lg">
              {connector.intro}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href={isSignedIn ? '/app/team/integrations' : '/sign-up'}>
                  {isSignedIn ? `Connect ${connector.name}` : 'Create your Timeline'}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="#how-it-works">See the evidence flow</Link>
              </Button>
            </div>
          </div>
        </div>
        <div className="mt-14 scroll-mt-12 sm:mt-20" id="how-it-works">
          <RecordsToAnswer connector={connector} />
        </div>
      </div>
    </section>
  );
}

function TruthBoundary({ connector }: { connector: ConnectorContent }) {
  return (
    <section className="border-b border-border py-16 sm:py-20" aria-labelledby="truth-boundary">
      <div className="grid gap-8 lg:grid-cols-[0.45fr_1fr]">
        <SectionIndex index="01" label="What gets captured" />
        <div>
          <div className="border-b border-border pb-6">
            <h2 id="truth-boundary" className="text-3xl font-semibold tracking-tight sm:text-4xl">
              What Timeline keeps—and what stays in {connector.name}.
            </h2>
          </div>
          <div className="grid gap-px border border-border bg-border sm:grid-cols-2">
            <article className="bg-bg p-6 sm:p-8">
              <span className="text-sm font-medium text-fg-dim">Timeline captures</span>
              <p className="mt-4 text-base leading-relaxed text-fg">{connector.captureStatement}</p>
            </article>
            <article className="bg-surface p-6 sm:p-8">
              <span className="text-sm font-medium text-fg-dim">{connector.name} remains</span>
              <p className="mt-4 text-base leading-relaxed text-fg-muted">
                {connector.providerStatement}
              </p>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}

function Questions({ connector }: { connector: ConnectorContent }) {
  return (
    <section className="border-b border-border py-16 sm:py-20" aria-labelledby="questions">
      <div className="grid gap-8 lg:grid-cols-[0.45fr_1fr]">
        <SectionLabel label="Questions" />
        <div>
          <h2
            id="questions"
            className="max-w-[18ch] text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Ask the operating question, not a search query.
          </h2>
          <ol className="mt-10 border-t border-border">
            {connector.exampleQuestions.map((question, index) => (
              <li
                key={question}
                className="grid grid-cols-[2.4rem_1fr] gap-4 border-b border-border py-5 sm:grid-cols-[4rem_1fr]"
              >
                <span className="font-mono text-xs text-fg-dim">0{index + 1}</span>
                <span className="text-lg font-medium text-fg sm:text-xl">{question}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function WorkedScenario({ connector }: { connector: ConnectorContent }) {
  return (
    <section className="border-b border-border py-16 sm:py-20" aria-labelledby="scenario">
      <div className="grid gap-8 lg:grid-cols-[0.45fr_1fr]">
        <SectionLabel label="Example" />
        <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr]">
          <div>
            <p className="mb-4 text-xs text-fg-dim">{PUBLIC_DEMO_DISCLOSURE}</p>
            <h2 id="scenario" className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {connector.scenario.title}
            </h2>
            <p className="mt-5 max-w-[52ch] text-base leading-relaxed text-fg-muted">
              {connector.scenario.situation}
            </p>
          </div>
          <div className="relative border-l border-border pl-8">
            <ol className="space-y-8">
              {connector.scenario.chronology.map((step, index) => (
                <li key={step} className="relative">
                  <span className="absolute -left-[2.36rem] top-1 grid size-5 place-items-center rounded-full border border-signal bg-bg font-mono text-[9px] text-fg">
                    {index + 1}
                  </span>
                  <p className="text-base leading-relaxed text-fg">{step}</p>
                </li>
              ))}
            </ol>
            <div className="mt-10 border-l-2 border-signal bg-signal-soft p-5">
              <span className="text-sm font-medium text-fg-dim">Result</span>
              <p className="mt-2 font-semibold text-fg">{connector.scenario.result}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CapturedRecords({ connector }: { connector: ConnectorContent }) {
  return (
    <section className="border-b border-border py-16 sm:py-20" aria-labelledby="records">
      <div className="grid gap-8 lg:grid-cols-[0.45fr_1fr]">
        <SectionLabel label="What Timeline saves" />
        <div>
          <h2 id="records" className="text-3xl font-semibold tracking-tight sm:text-4xl">
            What enters the Timeline
          </h2>
          <div className="mt-10 grid gap-px border border-border bg-border sm:grid-cols-2">
            {connector.capturedRecords.map((record, index) => (
              <div key={record} className="flex min-h-24 gap-4 bg-bg p-5">
                <span className="font-mono text-xs text-fg-dim">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <p className="font-medium text-fg">{record}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Recipes({ connector }: { connector: ConnectorContent }) {
  return (
    <section className="border-b border-border py-16 sm:py-20" aria-labelledby="recipes">
      <div className="grid gap-8 lg:grid-cols-[0.45fr_1fr]">
        <SectionLabel label="Use it with" />
        <div>
          <h2 id="recipes" className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Better when the silos meet
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {connector.recipes.map((recipe) => (
              <article
                key={recipe.title}
                className="flex flex-col rounded-md border border-border bg-surface p-5"
              >
                <h3 className="text-lg font-semibold text-fg">{recipe.title}</h3>
                <p className="mt-3 grow text-sm leading-relaxed text-fg-muted">{recipe.summary}</p>
                <div className="mt-8 flex flex-wrap items-center gap-2" aria-label="Recipe sources">
                  {recipe.sources.map((source, index) => (
                    <span key={source} className="contents">
                      {index > 0 ? (
                        <span className="text-fg-dim" aria-hidden="true">
                          +
                        </span>
                      ) : null}
                      <span className="text-xs font-medium text-fg">{source}</span>
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SetupAndPrivacy({ connector }: { connector: ConnectorContent }) {
  return (
    <section className="border-b border-border py-16 sm:py-20" aria-labelledby="setup">
      <div className="grid gap-8 lg:grid-cols-[0.45fr_1fr]">
        <SectionLabel label="Setup and privacy" />
        <div className="grid gap-px border border-border bg-border lg:grid-cols-2">
          <article className="bg-bg p-6 sm:p-8">
            <Sparkles aria-hidden="true" className="size-5 text-signal" />
            <h2 id="setup" className="mt-5 text-2xl font-semibold tracking-tight">
              Setup overview
            </h2>
            <ol className="mt-6 space-y-5">
              {connector.setup.map((step, index) => (
                <li key={step} className="grid grid-cols-[1.8rem_1fr] gap-3">
                  <span className="font-mono text-xs text-fg-dim">0{index + 1}</span>
                  <span className="text-sm leading-relaxed text-fg">{step}</span>
                </li>
              ))}
            </ol>
          </article>
          <article className="bg-surface p-6 sm:p-8">
            <LockKeyhole aria-hidden="true" className="size-5 text-signal" />
            <h2 className="mt-5 text-2xl font-semibold tracking-tight">Permissions and privacy</h2>
            <ul className="mt-6 space-y-5">
              {connector.permissions.map((item) => (
                <li key={item} className="grid grid-cols-[1.25rem_1fr] gap-3">
                  <Check aria-hidden="true" className="mt-0.5 size-4 text-signal" />
                  <span className="text-sm leading-relaxed text-fg-muted">{item}</span>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}

function Limitations({ connector }: { connector: ConnectorContent }) {
  return (
    <section className="border-b border-border py-16 sm:py-20" aria-labelledby="limitations">
      <div className="grid gap-8 lg:grid-cols-[0.45fr_1fr]">
        <SectionLabel label="Limits" />
        <div>
          <h2 id="limitations" className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Honest limitations
          </h2>
          <p className="mt-4 max-w-[62ch] text-base leading-relaxed text-fg-muted">
            Review these capture and recovery boundaries before connecting your account.
          </p>
          <ul className="mt-8 border-t border-border">
            {connector.limitations.map((limitation) => (
              <li
                key={limitation}
                className="grid grid-cols-[1.5rem_1fr] gap-4 border-b border-border py-5"
              >
                <Minus aria-hidden="true" className="mt-1 size-4 text-fg-dim" />
                <span className="text-base leading-relaxed text-fg">{limitation}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Faq({ connector }: { connector: ConnectorContent }) {
  return (
    <section className="border-b border-border py-16 sm:py-20" aria-labelledby="faq">
      <div className="grid gap-8 lg:grid-cols-[0.45fr_1fr]">
        <SectionLabel label="FAQ" />
        <div>
          <h2 id="faq" className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Questions, answered
          </h2>
          <div className="mt-8 border-t border-border">
            {connector.faqs.map((faq) => (
              <details key={faq.question} className="group border-b border-border">
                <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-6 rounded-sm py-4 text-base font-semibold text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg [&::-webkit-details-marker]:hidden">
                  {faq.question}
                  <span
                    className="text-lg font-normal text-fg-dim group-open:rotate-45"
                    aria-hidden="true"
                  >
                    +
                  </span>
                </summary>
                <p className="max-w-[66ch] pb-6 text-base leading-relaxed text-fg-muted">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Related({ connector }: { connector: ConnectorContent }) {
  const related = connector.related.map(findConnector).filter((item) => item !== undefined);
  return (
    <section className="border-b border-border py-16 sm:py-20" aria-labelledby="related">
      <div className="grid gap-8 lg:grid-cols-[0.45fr_1fr]">
        <SectionLabel label="Related" />
        <div>
          <h2 id="related" className="text-2xl font-semibold tracking-tight">
            Continue across the work
          </h2>
          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            {related.map((item) => (
              <Link
                key={item.slug}
                href={`/integrations/${item.slug}`}
                className="group flex min-h-28 flex-col justify-between rounded-md border border-border bg-bg p-4 outline-none transition-colors hover:border-border-strong hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                <span className="text-base font-semibold text-fg">{item.name}</span>
                <span className="flex items-center gap-2 text-sm text-fg-muted group-hover:text-fg">
                  Explore integration <ArrowRight aria-hidden="true" className="size-4" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCta({ connector, isSignedIn }: { connector: ConnectorContent; isSignedIn: boolean }) {
  return (
    <section className="py-20 sm:py-28" aria-labelledby="cta">
      <div className="grid gap-10 lg:grid-cols-[0.45fr_1fr]">
        <SectionIndex index="10" label="Start" />
        <div>
          <h2
            id="cta"
            className="max-w-[14ch] text-4xl font-semibold leading-tight tracking-[-0.04em] sm:text-6xl"
          >
            Try one real {connector.name} question.
          </h2>
          <p className="mt-6 max-w-[54ch] text-base leading-relaxed text-fg-muted sm:text-lg">
            Choose the sources your team trusts. Let the work form a chronology. Inspect the
            evidence behind every answer.
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link href={isSignedIn ? '/app/team/integrations' : '/sign-up'}>
              {isSignedIn ? `Connect ${connector.name}` : 'Create your Timeline'}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function SectionIndex({ index, label }: { index: string; label: string }) {
  return (
    <p className="flex items-baseline gap-1.5 text-sm font-medium text-fg-muted">
      <span className="font-mono text-[11px] text-fg-dim">{index}</span>
      <span aria-hidden="true">/</span>
      <span>{label}</span>
    </p>
  );
}

function SectionLabel({ label }: { label: string }) {
  return <p className="text-sm font-medium text-fg-muted">{label}</p>;
}
