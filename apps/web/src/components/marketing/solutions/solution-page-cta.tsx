import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import type { SolutionContent } from '@/components/marketing/solutions/content';

import { EditorialKicker } from '@/components/marketing/editorial/editorial-kicker';

const focusLink =
  'rounded-sm outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function SolutionPageCta({ cta }: { cta: SolutionContent['cta'] }) {
  return (
    <section className="border-t border-border bg-surface" aria-labelledby="cta-title">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-14 sm:px-6 sm:py-20 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <EditorialKicker>Start small</EditorialKicker>
          <h2
            id="cta-title"
            className="mt-5 text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl"
          >
            {cta.title}
          </h2>
          <p className="mt-5 text-base leading-7 text-fg-muted">{cta.body}</p>
        </div>
        <div className="flex flex-col items-start gap-3 lg:items-end">
          <Link
            href={cta.href}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-sm bg-fg px-6 text-sm font-semibold text-bg outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {cta.label}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <p className="max-w-xs text-sm leading-6 text-fg-muted lg:text-right">
            Free to start · no card required ·{' '}
            <Link
              href="/pricing"
              className={`${focusLink} underline decoration-border-strong underline-offset-4 hover:decoration-fg`}
            >
              See pricing
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
