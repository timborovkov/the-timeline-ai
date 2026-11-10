import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import type { ReactNode } from 'react';

import { CTA_MICROCOPY_LEAD, START_FREE_HREF, START_FREE_LABEL } from '@/components/marketing/copy';
import { FirstRunPath } from '@/components/marketing/first-run-path';
import { PublicSessionBranch } from '@/components/public-session-branch';
import { cn } from '@/lib/utils';

const focusLink =
  'rounded-sm underline decoration-border-strong underline-offset-4 outline-none hover:decoration-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function StartFreeLink({
  className,
  children = START_FREE_LABEL,
  showArrow = true,
  analyticsCta = 'start_free',
}: {
  className?: string;
  children?: ReactNode;
  showArrow?: boolean;
  analyticsCta?: string;
}) {
  return (
    <PublicSessionBranch
      signedOut={
        <Link href={START_FREE_HREF} data-public-analytics-cta={analyticsCta} className={className}>
          {children}
          {showArrow ? <ArrowRight aria-hidden="true" className="size-4" /> : null}
        </Link>
      }
      signedIn={
        <Link href="/app" data-public-analytics-cta="open_dashboard" className={className}>
          Go to dashboard
          {showArrow ? <ArrowRight aria-hidden="true" className="size-4" /> : null}
        </Link>
      }
    />
  );
}

function CtaMicrocopy({
  className,
  align = 'start',
}: {
  className?: string;
  align?: 'start' | 'end';
}) {
  return (
    <PublicSessionBranch
      signedOut={
        <p
          className={cn(
            'text-sm leading-6 text-fg-muted',
            align === 'end' && 'lg:text-right',
            className,
          )}
        >
          {CTA_MICROCOPY_LEAD}{' '}
          <Link href="/pricing" className={focusLink}>
            See pricing
          </Link>
        </p>
      }
      signedIn={null}
    />
  );
}

export function MarketingCtaBand({
  kicker = 'Start free',
  title,
  body,
  firstRun = false,
}: {
  kicker?: string;
  title: string;
  body: string;
  firstRun?: boolean;
}) {
  return (
    <section className="border-t border-border bg-surface" aria-labelledby="cta-title">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-14 sm:px-6 sm:py-20 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="font-mono text-[0.68rem] tracking-[0.14em] text-signal uppercase">
            {kicker}
          </p>
          <h2
            id="cta-title"
            className="mt-5 text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl"
          >
            {title}
          </h2>
          <p className="mt-5 text-base leading-7 text-fg-muted">{body}</p>
          {firstRun ? <FirstRunPath /> : null}
        </div>
        <div className="flex flex-col items-start gap-3 lg:items-end">
          <StartFreeLink className="inline-flex min-h-12 items-center justify-center gap-2 rounded-sm bg-signal px-6 text-sm font-semibold text-signal-fg outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface" />
          <CtaMicrocopy align="end" />
        </div>
      </div>
    </section>
  );
}
