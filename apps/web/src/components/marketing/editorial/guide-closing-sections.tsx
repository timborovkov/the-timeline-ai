import { ArrowRight, ExternalLink } from 'lucide-react';
import Link from 'next/link';

import type { EditorialGuide } from '@/components/marketing/editorial/content';

import {
  EDITORIAL_PUBLICATION_NAME,
  findEditorialGuideByRoute,
  RECORD_ROUTE,
} from '@/components/marketing/editorial/content';
import { EditorialKicker } from '@/components/marketing/editorial/editorial-kicker';
import { EditorialSectionHeading } from '@/components/marketing/editorial/editorial-section-heading';
import styles from '@/components/marketing/editorial/editorial.module.css';

export function GuideClosingSections({ guide }: { guide: EditorialGuide }) {
  return (
    <>
      <section className="mx-auto grid max-w-[94rem] gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:gap-20 lg:px-10">
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
          <h2 className="text-xl font-semibold tracking-[-0.025em]">Limitations to keep visible</h2>
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
        <div className="mx-auto max-w-[94rem] px-4 py-16 sm:px-6 sm:py-24 lg:px-10">
          <EditorialSectionHeading title="The useful follow-ups." />
          <div className="mt-10 ml-auto max-w-4xl border-t border-border">
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

      <section className="mx-auto max-w-[94rem] px-4 py-16 sm:px-6 sm:py-24 lg:px-10">
        <EditorialSectionHeading title="Related field notes." />
        <div className="mt-10 grid gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-2">
          {guide.relatedRoutes.map((route) => {
            const related = findEditorialGuideByRoute(route);
            return (
              <Link
                key={related.route}
                href={related.route}
                className="group bg-bg p-6 outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:p-8"
              >
                <p className="font-mono text-[0.62rem] tracking-[0.12em] text-signal uppercase">
                  {related.issue} / {related.typeLabel}
                </p>
                <h3 className="mt-5 max-w-xl text-xl font-semibold tracking-[-0.025em] sm:text-2xl">
                  {related.title}
                </h3>
                <span className="mt-7 inline-flex items-center gap-2 text-sm font-semibold">
                  Read guide
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-1"
                  />
                </span>
              </Link>
            );
          })}
          <Link
            href={RECORD_ROUTE}
            className="group bg-bg p-6 outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:p-8"
          >
            <p className="font-mono text-[0.62rem] tracking-[0.12em] text-signal uppercase">
              Publication / Index
            </p>
            <h3 className="mt-5 max-w-xl text-xl font-semibold tracking-[-0.025em] sm:text-2xl">
              Browse every entry in {EDITORIAL_PUBLICATION_NAME}.
            </h3>
            <span className="mt-7 inline-flex items-center gap-2 text-sm font-semibold">
              Open the index
              <ExternalLink aria-hidden="true" className="size-4" />
            </span>
          </Link>
        </div>
      </section>

      <section className={`${styles.ctaStage} mx-auto max-w-[94rem] px-6 py-16 sm:px-10 sm:py-24`}>
        <div className="relative z-10 max-w-3xl">
          <EditorialKicker>Start / One real question</EditorialKicker>
          <h2 className="mt-6 text-balance text-4xl font-semibold tracking-[-0.05em] sm:text-5xl lg:text-6xl">
            {guide.cta.title}
          </h2>
          <p className="mt-6 max-w-2xl text-base leading-8 opacity-72 sm:text-lg">
            {guide.cta.body}
          </p>
          <Link
            href={guide.cta.href}
            className="mt-9 inline-flex min-h-12 items-center gap-8 rounded-sm bg-signal px-5 font-semibold text-signal-fg outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-bg focus-visible:ring-offset-2 focus-visible:ring-offset-fg"
          >
            {guide.cta.label}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </section>
    </>
  );
}
