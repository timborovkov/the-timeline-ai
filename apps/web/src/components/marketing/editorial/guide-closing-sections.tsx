import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import type { EditorialGuide } from '@/components/marketing/editorial/content';

import {
  findEditorialGuideByRoute,
  HOW_IT_WORKS_ROUTE,
} from '@/components/marketing/editorial/content';
import { EditorialKicker } from '@/components/marketing/editorial/editorial-kicker';
import { EditorialSectionHeading } from '@/components/marketing/editorial/editorial-section-heading';

export function GuideClosingSections({ guide }: { guide: EditorialGuide }) {
  return (
    <>
      <section className="mx-auto grid max-w-5xl gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
        <div>
          <h2 className="border-t border-border pt-5 text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
            {guide.interpretation.title}
          </h2>
          <div className="mt-7 space-y-5 text-base leading-8 text-fg-muted">
            {guide.interpretation.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </div>
        <div className="border-t border-border pt-6 lg:mt-0">
          <h2 className="text-xl font-semibold tracking-[-0.025em]">What this cannot prove</h2>
          <ul className="mt-6 grid gap-0">
            {guide.limitations.map((limitation, index) => (
              <li
                key={limitation}
                className="grid grid-cols-[2.5rem_1fr] gap-3 border-b border-border py-4 text-sm leading-7"
              >
                <span className="font-mono text-[0.62rem] tracking-[0.1em] text-signal">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span>{limitation}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-y border-border bg-surface/45">
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
          <EditorialSectionHeading title="Common follow-up questions" />
          <div className="mt-8 border-t border-border">
            {guide.faqs.map((faq) => (
              <details key={faq.question} className="group border-b border-border">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-5 rounded-sm py-4 text-base font-semibold outline-none marker:content-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
                  {faq.question}
                  <span
                    aria-hidden="true"
                    className="font-mono text-lg text-signal group-open:rotate-45 motion-safe:transition-transform motion-safe:duration-200"
                  >
                    +
                  </span>
                </summary>
                <p className="max-w-3xl pb-6 text-sm leading-7 text-fg-muted sm:text-base">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
        <EditorialSectionHeading title="Related walkthroughs" />
        <div className="mt-8 grid gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-2">
          {guide.relatedRoutes.map((route) => {
            const related = findEditorialGuideByRoute(route);
            return (
              <Link
                key={related.route}
                href={related.route}
                className="group bg-bg p-6 outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:p-8"
              >
                <p className="font-mono text-[0.62rem] tracking-[0.12em] text-signal uppercase">
                  {related.nativeConnectors.join(' + ')}
                </p>
                <h3 className="mt-5 max-w-xl text-xl font-semibold tracking-[-0.025em] sm:text-2xl">
                  {related.title}
                </h3>
                <span className="mt-7 inline-flex items-center gap-2 text-sm font-semibold">
                  Read walkthrough
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-1"
                  />
                </span>
              </Link>
            );
          })}
          <Link
            href={HOW_IT_WORKS_ROUTE}
            className="group bg-bg p-6 outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:p-8"
          >
            <p className="font-mono text-[0.62rem] tracking-[0.12em] text-signal uppercase">
              How Timeline works
            </p>
            <h3 className="mt-5 max-w-xl text-xl font-semibold tracking-[-0.025em] sm:text-2xl">
              See how source records become a cited answer.
            </h3>
            <span className="mt-7 inline-flex items-center gap-2 text-sm font-semibold">
              Back to the overview
              <ArrowRight aria-hidden="true" className="size-4" />
            </span>
          </Link>
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
          <EditorialKicker>Try it on one real question</EditorialKicker>
          <h2 className="mt-5 max-w-3xl text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
            {guide.cta.title}
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-8 text-fg-muted sm:text-lg">
            {guide.cta.body}
          </p>
          <Link
            href={guide.cta.href}
            className="mt-8 inline-flex min-h-12 items-center gap-6 rounded-sm bg-signal px-5 font-semibold text-signal-fg outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {guide.cta.label}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </section>
    </>
  );
}
