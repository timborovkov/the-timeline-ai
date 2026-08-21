import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import type { SolutionContent } from '@/components/marketing/solutions/content';

import { EditorialSectionHeading } from '@/components/marketing/editorial/editorial-section-heading';

const focusLink =
  'rounded-sm outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function SolutionPageRelated({
  relatedSolutions,
  furtherReading,
}: {
  relatedSolutions: SolutionContent[];
  furtherReading: SolutionContent['furtherReading'];
}) {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <EditorialSectionHeading index="06 · Explore" title="Related solutions." />
          {furtherReading ? (
            <Link
              href={furtherReading.href}
              className={`${focusLink} inline-flex items-center gap-2 text-sm font-medium`}
            >
              {furtherReading.label}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          ) : null}
        </div>
        <div className="mt-10 grid gap-px bg-border sm:grid-cols-2">
          {relatedSolutions.map((related) => (
            <Link
              key={related.route}
              href={related.route}
              className="group bg-bg p-6 outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-8"
            >
              <p className="font-mono text-[0.65rem] tracking-[0.12em] text-signal uppercase">
                {related.audienceLabel}
              </p>
              <h3 className="mt-5 text-xl font-semibold tracking-[-0.025em]">
                {related.shortTitle}
              </h3>
              <p className="mt-3 text-sm leading-7 text-fg-muted">{related.seoDescription}</p>
              <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium">
                Read the solution
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-1"
                />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
