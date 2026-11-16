import { ArrowRight, Check, LockKeyhole, Minus, Sparkles } from 'lucide-react';
import Link from 'next/link';

import {
  findConnector,
  type ConnectorContent,
} from '@/components/marketing/integrations/connector-content';
import { ConnectorPreview } from '@/components/marketing/integrations/connector-preview';
import { ConnectorStructuredData } from '@/components/marketing/integrations/connector-seo';
import detailStyles from '@/components/marketing/integrations/integration-detail.module.css';
import { findWorksWithTool } from '@/components/marketing/integrations/works-with-content';
import { WorksWithGuidance } from '@/components/marketing/integrations/works-with-sections';
import { MarketingDisclosure } from '@/components/marketing/marketing-disclosure';
import { MarketingContainer, MarketingSectionGrid } from '@/components/marketing/marketing-layout';
import { MarketingProductScreenshot } from '@/components/marketing/product-screenshot';
import publicStyles from '@/components/marketing/public-page.module.css';
import { ProviderLogo } from '@/components/provider-logo';
import { PublicSessionBranch } from '@/components/public-session-branch';
import { PublicShell } from '@/components/public-shell';
import { Button } from '@/components/ui/button';

export function ConnectorPage({ connector }: { connector: ConnectorContent }) {
  return (
    <PublicShell footerLabel={`${connector.name} integration`} currentSection="integrations">
      <ConnectorStructuredData connector={connector} />
      <main id="main" tabIndex={-1}>
        <ConnectorHero connector={connector} />
        <MarketingContainer>
          <TruthBoundary connector={connector} />
          <ConnectorWorksWithGuidance slug={connector.slug} />
          <WorkedScenario connector={connector} />
          {connector.screenshot ? (
            <section
              className={detailStyles.section}
              aria-label={`${connector.name} in The Timeline`}
            >
              <MarketingProductScreenshot
                file={connector.screenshot.file}
                alt={connector.screenshot.alt}
                caption={connector.screenshot.caption}
              />
            </section>
          ) : null}

          <CapturedRecords connector={connector} />
          <Recipes connector={connector} />
          <Questions connector={connector} />
          <SetupAndPrivacy connector={connector} />
          <Limitations connector={connector} />
          <Faq connector={connector} />
          <Related connector={connector} />
          <FinalCta connector={connector} />
        </MarketingContainer>
      </main>
    </PublicShell>
  );
}

function ConnectorWorksWithGuidance({ slug }: { slug: string }) {
  const tool = findWorksWithTool(slug);
  if (!tool) return null;
  return <WorksWithGuidance tool={tool} />;
}

function ConnectorHero({ connector }: { connector: ConnectorContent }) {
  return (
    <section>
      <MarketingContainer className={detailStyles.hero}>
        <Link href="/integrations" className={detailStyles.back}>
          All integrations
        </Link>
        <div className={detailStyles.heroGrid}>
          <div>
            <div className={detailStyles.identity}>
              <ProviderLogo src={connector.logo} size="md" />
              <span>{connector.name} · Native integration</span>
            </div>
            <h1 className={detailStyles.title}>{connector.hero}</h1>
            <p className={detailStyles.intro}>{connector.intro}</p>
            <div className={detailStyles.actions}>
              <PublicSessionBranch
                signedOut={
                  <Button asChild size="lg">
                    <Link href="/sign-up">
                      Start free
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                }
                signedIn={
                  <Button asChild size="lg">
                    <Link href="/app/connections">
                      Connect {connector.name}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                }
              />
              <Link href="#how-it-works" className="underline underline-offset-4 py-3">
                See how it fits
              </Link>
            </div>
            <p className={detailStyles.note}>
              You choose the sources. {connector.name} stays where your team works.
            </p>
          </div>
          <ConnectorPreview connector={connector} />
        </div>
        <nav aria-label="On this integration page" className={detailStyles.nav}>
          <a href="#truth-boundary">What comes in</a>
          <a href="#how-it-works">In practice</a>
          <a href="#setup">Setup & permissions</a>
          <a href="#limitations">Limits</a>
        </nav>
      </MarketingContainer>
    </section>
  );
}

function TruthBoundary({ connector }: { connector: ConnectorContent }) {
  return (
    <section className={detailStyles.section} aria-labelledby="truth-boundary">
      <div className={detailStyles.split}>
        <h2 id="truth-boundary" className="scroll-mt-24">
          What Timeline keeps, and what stays in {connector.name}.
        </h2>
        <div className={detailStyles.status}>
          <div>
            <h3 className="text-lg font-medium">Timeline captures</h3>
            <p>{connector.captureStatement}</p>
          </div>
          <div>
            <h3 className="text-lg font-medium">{connector.name} remains</h3>
            <p>{connector.providerStatement}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Questions({ connector }: { connector: ConnectorContent }) {
  return (
    <section className="border-b border-border py-8" aria-labelledby="questions">
      <details>
        <summary
          id="questions"
          className="cursor-pointer rounded-sm py-3 text-lg font-medium focus-visible:outline-2"
        >
          Questions you can explore with {connector.name} evidence
        </summary>
        <ul className="mt-4 grid gap-x-8 sm:grid-cols-2">
          {connector.exampleQuestions.map((question) => (
            <li key={question} className="border-t border-border py-4 leading-7 text-fg-muted">
              {question}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function WorkedScenario({ connector }: { connector: ConnectorContent }) {
  return (
    <section
      id="how-it-works"
      className="border-b border-border py-10 sm:py-14"
      aria-labelledby="scenario"
    >
      <MarketingSectionGrid>
        <div className="grid gap-8 grid-cols-[minmax(0,1fr)]">
          <div>
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
                  <span className="absolute -left-[2.36rem] top-1 grid size-5 place-items-center rounded-full border border-signal bg-bg font-mono text-xs text-fg">
                    {index + 1}
                  </span>
                  <p className="text-base leading-relaxed text-fg">{step}</p>
                </li>
              ))}
            </ol>
            <div className="mt-10 border-l border-signal bg-signal-soft p-5">
              <span className="text-sm font-medium text-fg">Result</span>
              <p className="mt-2 font-semibold text-fg">{connector.scenario.result}</p>
            </div>
          </div>
        </div>
      </MarketingSectionGrid>
    </section>
  );
}

function CapturedRecords({ connector }: { connector: ConnectorContent }) {
  return (
    <section className="border-b border-border py-10 sm:py-14" aria-labelledby="records">
      <MarketingSectionGrid>
        <div>
          <h2 id="records" className="text-3xl font-semibold tracking-tight sm:text-4xl">
            What enters the Timeline
          </h2>
          <div className="mt-6 grid gap-x-8 sm:grid-cols-2">
            {connector.capturedRecords.map((record) => (
              <div key={record} className="border-t border-border py-5">
                <p className="font-medium text-fg">{record}</p>
              </div>
            ))}
          </div>
        </div>
      </MarketingSectionGrid>
    </section>
  );
}

function Recipes({ connector }: { connector: ConnectorContent }) {
  return (
    <section className="border-b border-border py-10 sm:py-14" aria-labelledby="recipes">
      <MarketingSectionGrid>
        <div>
          <h2 id="recipes" className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Connect it to the rest of the work
          </h2>
          <div className="mt-8 divide-y divide-border">
            {connector.recipes.map((recipe) => (
              <article
                key={recipe.title}
                className="grid gap-4 py-6 sm:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]"
              >
                <h3 className="text-lg font-semibold text-fg">{recipe.title}</h3>
                <p className="text-base leading-relaxed text-fg-muted">{recipe.summary}</p>
                <div
                  className="sm:col-start-2 flex flex-wrap items-center gap-2"
                  aria-label="Recipe sources"
                >
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
      </MarketingSectionGrid>
    </section>
  );
}

function SetupAndPrivacy({ connector }: { connector: ConnectorContent }) {
  return (
    <section className="border-b border-border py-10 sm:py-14" aria-labelledby="setup">
      <MarketingSectionGrid>
        <div className="grid gap-px border border-border bg-border lg:grid-cols-2">
          <article className="bg-bg p-6 sm:p-8">
            <Sparkles aria-hidden="true" className="size-5 text-signal" />
            <h2 id="setup" className="scroll-mt-24 mt-5 text-2xl font-semibold tracking-tight">
              Setup overview
            </h2>
            <ol className="mt-6 space-y-5">
              {connector.setup.map((step, index) => (
                <li key={step} className="grid grid-cols-[1.8rem_minmax(0,1fr)] gap-3">
                  <span className="font-mono text-xs text-fg-muted">{index + 1}</span>
                  <span className="text-sm leading-relaxed text-fg">{step}</span>
                </li>
              ))}
            </ol>
          </article>
          <article className="bg-surface p-6 sm:p-8">
            <LockKeyhole aria-hidden="true" className="size-5 text-signal" />
            <h2 className="mt-5 text-2xl font-semibold tracking-tight">Permissions and privacy</h2>
            <MarketingDisclosure summary="Read permissions and privacy details">
              <ul className="mt-6 space-y-5">
                {connector.permissions.map((item) => (
                  <li key={item} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3">
                    <Check aria-hidden="true" className="mt-0.5 size-4 text-signal" />
                    <span className="min-w-0 [overflow-wrap:anywhere] text-sm leading-relaxed text-fg-muted">
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </MarketingDisclosure>
          </article>
        </div>
      </MarketingSectionGrid>
    </section>
  );
}

function Limitations({ connector }: { connector: ConnectorContent }) {
  return (
    <section className="border-b border-border py-10 sm:py-14" aria-labelledby="limitations">
      <MarketingSectionGrid>
        <div>
          <h2
            id="limitations"
            className="scroll-mt-24 text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Capture limits and recovery
          </h2>
          <p className="mt-4 max-w-[62ch] text-base leading-relaxed text-fg-muted">
            Review these capture and recovery boundaries before connecting your account.
          </p>
          <details className="mt-6 border-t border-border pt-4">
            <summary className="cursor-pointer text-base font-medium text-fg">
              Read capture limits, history coverage and recovery behaviour
            </summary>
            <ul className="mt-4 border-t border-border">
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
          </details>
        </div>
      </MarketingSectionGrid>
    </section>
  );
}

function Faq({ connector }: { connector: ConnectorContent }) {
  return (
    <section className="border-b border-border py-10 sm:py-14" aria-labelledby="faq">
      <MarketingSectionGrid>
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
      </MarketingSectionGrid>
    </section>
  );
}

function Related({ connector }: { connector: ConnectorContent }) {
  const related = connector.related.map(findConnector).filter((item) => item !== undefined);
  return (
    <section className="border-b border-border py-10 sm:py-14" aria-labelledby="related">
      <MarketingSectionGrid>
        <div>
          <h2 id="related" className="text-2xl font-semibold tracking-tight">
            Continue across the work
          </h2>
          <div className="mt-7 divide-y divide-border">
            {related.map((item) => (
              <Link
                key={item.slug}
                href={`/integrations/${item.slug}`}
                className="group flex min-h-20 flex-wrap items-center justify-between gap-4 py-4 outline-none transition-colors hover:text-signal focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-base font-semibold text-fg">{item.name}</span>
                <span className="flex items-center gap-2 text-sm text-fg-muted group-hover:text-fg">
                  Explore integration <ArrowRight aria-hidden="true" className="size-4" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </MarketingSectionGrid>
    </section>
  );
}

function FinalCta({ connector }: { connector: ConnectorContent }) {
  return (
    <section className={publicStyles.cta} aria-labelledby="cta">
      <div className={publicStyles.ctaPanel}>
        <div>
          <h2 id="cta" className="max-w-[24ch]">
            Bring {connector.name} into the picture.
          </h2>
          <p className="mt-6 max-w-[54ch] text-base leading-relaxed text-fg-muted sm:text-lg">
            Start with the sources your team uses. Keep their history together, with the evidence
            behind the work.
          </p>
        </div>
        <div className={publicStyles.ctaAction}>
          <PublicSessionBranch
            signedOut={
              <Button asChild size="lg" className="mt-0">
                <Link href="/sign-up">
                  Start free
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            }
            signedIn={
              <Button asChild size="lg" className="mt-0">
                <Link href="/app/connections">
                  {`Connect ${connector.name}`}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            }
          />
        </div>
      </div>
    </section>
  );
}
