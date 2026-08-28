import { ArrowRight, Check, ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { EditorialKicker } from '@/components/marketing/editorial/editorial-kicker';
import { EditorialSectionHeading } from '@/components/marketing/editorial/editorial-section-heading';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import styles from '@/components/marketing/editorial/editorial.module.css';
import {
  findSolutionByRoute,
  type SolutionContent,
} from '@/components/marketing/solutions/content';
import { buildSolutionStructuredData } from '@/components/marketing/solutions/metadata';
import { SolutionPageCta } from '@/components/marketing/solutions/solution-page-cta';
import { SolutionPageRelated } from '@/components/marketing/solutions/solution-page-related';

const focusLink =
  'rounded-sm outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function SolutionPage({ solution }: { solution: SolutionContent }) {
  const relatedSolutions = solution.relatedRoutes.map(findSolutionByRoute);

  return (
    <main id="main" tabIndex={-1} data-solution-route={solution.route}>
      <EditorialStructuredData data={buildSolutionStructuredData(solution)} />
      <article>
        <header className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <nav aria-label="Breadcrumb" className="mb-9">
            <ol className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              <li>
                <Link href="/" className={focusLink}>
                  Timeline
                </Link>
              </li>
              <li aria-hidden="true">
                <ChevronRight className="size-3.5" />
              </li>
              <li aria-current="page" className="text-fg">
                {solution.shortTitle}
              </li>
            </ol>
          </nav>

          <div className={styles.heroGrid}>
            <div>
              <EditorialKicker>{solution.eyebrow}</EditorialKicker>
              <h1 className={`${styles.guideTitle} mt-6`}>{solution.title}</h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-fg-muted sm:text-xl">
                {solution.summary}
              </p>
              <p className="mt-7 inline-flex min-h-10 items-center border border-border bg-surface px-3 font-mono text-[0.65rem] tracking-[0.1em] text-fg-muted uppercase">
                {solution.audienceLabel}
              </p>
            </div>

            <aside
              aria-label="Direct answer"
              className={`${styles.indexRule} border-y border-border py-8 pl-7 sm:pl-9`}
            >
              <p className="font-mono text-[0.68rem] tracking-[0.14em] text-signal uppercase">
                Start with the answer
              </p>
              <h2 className="mt-5 text-balance text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
                {solution.answer.title}
              </h2>
              <p className="mt-5 text-base leading-7 text-fg-muted">{solution.answer.body}</p>
              <ul className="mt-7 grid gap-3">
                {solution.answer.checklist.map((item) => (
                  <li key={item} className="grid grid-cols-[1rem_1fr] gap-3 text-sm leading-6">
                    <Check aria-hidden="true" className="mt-1 size-4 text-signal" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </header>

        <section className="border-y border-border bg-surface/45" aria-labelledby="problem-title">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[0.42fr_1fr]">
            <div>
              <EditorialKicker>The problem</EditorialKicker>
              <h2 id="problem-title" className="mt-5 text-2xl font-semibold tracking-[-0.035em]">
                Context breaks between systems.
              </h2>
            </div>
            <div
              className={`${styles.readingMeasure} grid gap-5 text-base leading-8 text-fg-muted`}
            >
              {solution.context.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <EditorialSectionHeading
            index="01 · Method"
            title="Turn selected work into a reviewable answer."
            intro="The same four-part discipline keeps the result useful: define the evidence, preserve its sequence, ask a bounded question, and verify before acting."
          />
          <ol className="mt-12 grid gap-0 lg:grid-cols-2 lg:gap-x-16">
            {solution.workflow.map((step) => (
              <li
                key={step.index}
                className={`${styles.workflowStep} grid grid-cols-[2rem_1fr] gap-5 pb-10`}
              >
                <span className={`${styles.workflowIndex} font-mono text-xs`} aria-hidden="true">
                  {step.index}
                </span>
                <div>
                  <h3 className="text-xl font-semibold tracking-[-0.025em]">{step.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-fg-muted sm:text-base">{step.body}</p>
                  <p className="mt-4 border-l border-signal pl-4 font-mono text-xs leading-6 text-fg-muted">
                    Output · {step.output}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-y border-border bg-surface/45">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
            <EditorialSectionHeading
              index="02 · Evidence"
              title="Give each source one honest job."
              intro="Citations are most useful when the answer preserves what each source can establish—and what it cannot."
            />
            <div className="mt-12 grid gap-px bg-border lg:grid-cols-3">
              {solution.evidenceRoles.map((source) => (
                <article key={source.label} className="flex flex-col bg-bg p-6 sm:p-8">
                  <p className="font-mono text-[0.68rem] tracking-[0.14em] text-signal uppercase">
                    {source.label}
                  </p>
                  <h3 className="mt-5 text-xl font-semibold tracking-[-0.025em]">{source.role}</h3>
                  <p className="mt-4 text-sm leading-7 text-fg-muted">{source.includes}</p>
                  <div className="mt-6 border-t border-border pt-5">
                    <p className="font-mono text-[0.62rem] tracking-[0.12em] text-fg-muted uppercase">
                      Boundary
                    </p>
                    <p className="mt-3 text-sm leading-6 text-fg-muted">{source.boundary}</p>
                  </div>
                  {source.href ? (
                    <Link
                      href={source.href}
                      className={`${focusLink} mt-6 inline-flex items-center gap-2 self-start text-sm font-medium`}
                    >
                      Inspect this source boundary
                      <ArrowRight aria-hidden="true" className="size-4" />
                    </Link>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[0.78fr_1.22fr]">
          <div>
            <EditorialSectionHeading
              index="03 · Ask"
              title="Start with a question that has edges."
              intro="Name the subject, the time window, the output, and the standard of evidence."
            />
            <ul className="mt-9 grid gap-3">
              {solution.questions.map((question) => (
                <li
                  key={question}
                  className="border-l border-border-strong py-2 pl-5 text-sm leading-7 text-fg-muted"
                >
                  “{question}”
                </li>
              ))}
            </ul>
          </div>

          <aside className={`${styles.promptBlock} p-7 sm:p-9`} aria-label={solution.example.label}>
            <div className="relative z-10">
              <p className="font-mono text-[0.68rem] tracking-[0.14em] text-signal uppercase">
                {solution.example.label}
              </p>
              <h2 className="mt-5 max-w-2xl text-balance text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
                {solution.example.title}
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-7 text-fg-muted">
                {solution.example.body}
              </p>
              <ol className="mt-8 grid gap-3">
                {solution.example.claims.map((claim, index) => (
                  <li key={claim} className="grid grid-cols-[1.6rem_1fr] gap-3 text-sm leading-6">
                    <span className="grid size-6 place-items-center rounded-full border border-signal font-mono text-[0.62rem] text-signal">
                      {index + 1}
                    </span>
                    <span>{claim}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-8 border-t border-border pt-5 font-mono text-[0.65rem] leading-5 text-fg-muted">
                {solution.example.note}
              </p>
            </div>
          </aside>
        </section>

        <section className="border-y border-border bg-surface/45">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
            <EditorialSectionHeading
              index="04 · Trust"
              title="What this cannot prove."
              intro="A useful AI team memory makes the gaps inspectable. It does not turn missing evidence into confidence."
            />
            <ul className="mt-10 grid gap-px bg-border sm:grid-cols-2">
              {solution.limitations.map((limitation, index) => (
                <li key={limitation} className="bg-bg p-6 text-sm leading-7 text-fg-muted sm:p-7">
                  <span className="mr-3 font-mono text-xs text-signal">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {limitation}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <EditorialSectionHeading index="05 · Questions" title="Common questions." />
          <div className="mt-10 divide-y divide-border border-y border-border">
            {solution.faqs.map((faq) => (
              <details key={faq.question} className="group py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-sm py-5 text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
                  {faq.question}
                  <span aria-hidden="true" className="font-mono text-signal group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="max-w-3xl pb-6 text-sm leading-7 text-fg-muted sm:text-base">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </section>

        <SolutionPageRelated
          relatedSolutions={relatedSolutions}
          furtherReading={solution.furtherReading}
        />
        <SolutionPageCta cta={solution.cta} />
      </article>
    </main>
  );
}
